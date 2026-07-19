using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Application.Services;

public interface IToolLoanService
{
    Task<List<ToolLoanDto>> GetActiveAsync(CancellationToken cancellationToken = default);
    Task<List<ToolLoanDto>> GetAllAsync(bool? returnedOnly = null, CancellationToken cancellationToken = default);
    Task<List<ToolLoanDto>> GetByCustomerPhoneAsync(string phone, CancellationToken cancellationToken = default);
    Task<ToolLoanDto> RenewAsync(int id, CancellationToken cancellationToken = default);
    Task<ToolLoanDto> CreateAsync(ToolLoanCreateDto dto, CancellationToken cancellationToken = default);
    Task<ToolLoanDto> MarkReturnedAsync(int id, ToolLoanReturnDto dto, CancellationToken cancellationToken = default);
    Task<ToolLoanDto> MarkItemReturnedAsync(
        int loanId,
        int itemId,
        ToolLoanReturnDto dto,
        CancellationToken cancellationToken = default);
    Task<ToolLoanDto> UndoItemReturnAsync(
        int loanId,
        int itemId,
        CancellationToken cancellationToken = default);
    Task DeleteAsync(int loanId, CancellationToken cancellationToken = default);
    Task<ToolLoanDto> ReturnByCodeAsync(
        ToolLoanReturnByCodeDto dto,
        CancellationToken cancellationToken = default);
    Task<List<ToolItemBorrowHistoryDto>> GetItemBorrowHistoryAsync(
        int toolDefinitionId,
        string serialCode,
        CancellationToken cancellationToken = default);
}

public class ToolLoanService : IToolLoanService
{
    /// <summary>Default tools loan period used when renewing (matches frontend default).</summary>
    public const int DefaultLoanHours = 2;

    private readonly AppDbContext _db;

    public ToolLoanService(AppDbContext db)
    {
        _db = db;
    }

    public Task<List<ToolLoanDto>> GetActiveAsync(CancellationToken cancellationToken = default)
        => GetAllAsync(returnedOnly: false, cancellationToken);

    public async Task<List<ToolLoanDto>> GetAllAsync(
        bool? returnedOnly = null,
        CancellationToken cancellationToken = default)
    {
        var query = _db.ToolLoans
            .AsNoTracking()
            .Include(l => l.Items)
                .ThenInclude(i => i.CustomerDebt)
            .AsQueryable();

        if (returnedOnly == true)
        {
            // Fully returned loans (every item returned, or legacy loan-level stamp).
            query = query.Where(l =>
                l.ReturnedAt != null ||
                (l.Items.Count > 0 && l.Items.All(i => i.ReturnedAt != null)));
        }
        else if (returnedOnly == false)
        {
            // Still has at least one open item.
            query = query.Where(l => l.Items.Any(i => i.ReturnedAt == null));
        }

        var rows = await query
            .OrderByDescending(l => l.LentAt)
            .ThenByDescending(l => l.Id)
            .ToListAsync(cancellationToken);

        return rows.Select(ToDto).ToList();
    }

    public async Task<List<ToolLoanDto>> GetByCustomerPhoneAsync(
        string phone,
        CancellationToken cancellationToken = default)
    {
        var normalizedPhone = (phone ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(normalizedPhone))
        {
            return [];
        }

        var rows = await _db.ToolLoans
            .AsNoTracking()
            .Include(l => l.Items)
                .ThenInclude(i => i.CustomerDebt)
            .Where(l => l.Phone == normalizedPhone)
            .OrderByDescending(l => l.LentAt)
            .ThenByDescending(l => l.Id)
            .ToListAsync(cancellationToken);

        return rows.Select(ToDto).ToList();
    }

    public async Task<ToolLoanDto> RenewAsync(int id, CancellationToken cancellationToken = default)
    {
        var entity = await _db.ToolLoans
            .Include(l => l.Items)
                .ThenInclude(i => i.CustomerDebt)
            .FirstOrDefaultAsync(l => l.Id == id, cancellationToken)
            ?? throw new NotFoundException("ההשאלה לא נמצאה");

        if (!entity.Items.Any(i => i.ReturnedAt == null))
        {
            throw new ValidationException("לא ניתן לחדש השאלה שכבר הוחזרה במלואה");
        }

        var now = DateTime.UtcNow;
        var baseDeadline = entity.DeadlineAt ?? now;
        if (baseDeadline < now)
        {
            baseDeadline = now;
        }

        entity.DeadlineAt = baseDeadline.AddHours(DefaultLoanHours);
        entity.UpdatedAt = now;
        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(entity);
    }

    public async Task<ToolLoanDto> CreateAsync(
        ToolLoanCreateDto dto,
        CancellationToken cancellationToken = default)
    {
        var phone = (dto.Phone ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(phone))
        {
            throw new ValidationException("יש להזין מספר טלפון");
        }

        var items = dto.Items ?? [];
        if (items.Count == 0)
        {
            throw new ValidationException("יש לבחור לפחות כלי אחד להשאלה");
        }

        var normalizedItems = new List<(int ToolDefinitionId, string SerialCode, string ToolName)>();

        foreach (var item in items)
        {
            var serial = (item.SerialCode ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(serial))
            {
                throw new ValidationException("קוד פריט חסר");
            }

            var definition = await _db.ToolDefinitions
                .AsNoTracking()
                .Include(t => t.SerialCodes)
                .FirstOrDefaultAsync(t => t.Id == item.ToolDefinitionId, cancellationToken)
                ?? throw new ValidationException($"סוג כלי #{item.ToolDefinitionId} לא נמצא");

            if (!definition.SerialCodes.Any(s => string.Equals(s.SerialCode, serial, StringComparison.OrdinalIgnoreCase)))
            {
                throw new ValidationException($"קוד {serial} אינו שייך ל־{definition.DisplayName}");
            }

            var alreadyOut = await _db.ToolLoanItems
                .AsNoTracking()
                .AnyAsync(
                    i => i.SerialCode == serial &&
                         i.ToolDefinitionId == definition.Id &&
                         i.ReturnedAt == null,
                    cancellationToken);

            if (alreadyOut)
            {
                throw new ValidationException($"קוד {serial} כבר מושאל");
            }

            normalizedItems.Add((definition.Id, serial, definition.DisplayName));
        }

        var entity = new ToolLoan
        {
            LentAt = DateTime.UtcNow,
            HebrewLentDisplay = (dto.HebrewLentDisplay ?? string.Empty).Trim(),
            ClientName = (dto.ClientName ?? string.Empty).Trim(),
            Phone = phone,
            Phone2 = string.IsNullOrWhiteSpace(dto.Phone2) ? null : dto.Phone2.Trim(),
            Address = string.IsNullOrWhiteSpace(dto.Address) ? null : dto.Address.Trim(),
            Deposit = string.IsNullOrWhiteSpace(dto.Deposit) ? null : dto.Deposit.Trim(),
            Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim(),
            DeadlineAt = dto.DeadlineAt,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            Items = normalizedItems
                .Select(i => new ToolLoanItem
                {
                    ToolDefinitionId = i.ToolDefinitionId,
                    ToolName = i.ToolName,
                    SerialCode = i.SerialCode
                })
                .ToList()
        };

        _db.ToolLoans.Add(entity);
        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(entity);
    }

    public async Task<ToolLoanDto> MarkReturnedAsync(
        int id,
        ToolLoanReturnDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await _db.ToolLoans
            .Include(l => l.Items)
            .FirstOrDefaultAsync(l => l.Id == id, cancellationToken)
            ?? throw new NotFoundException("ההשאלה לא נמצאה");

        var stamp = DateTime.UtcNow;
        var hebrew = (dto.HebrewReturnedDisplay ?? string.Empty).Trim();

        foreach (var item in entity.Items.Where(i => i.ReturnedAt == null))
        {
            item.ReturnedAt = stamp;
            item.HebrewReturnedDisplay = hebrew;
        }

        entity.ReturnedAt = stamp;
        entity.HebrewReturnedDisplay = hebrew;
        entity.UpdatedAt = stamp;
        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(entity);
    }

    public async Task<ToolLoanDto> MarkItemReturnedAsync(
        int loanId,
        int itemId,
        ToolLoanReturnDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await _db.ToolLoans
            .Include(l => l.Items)
                .ThenInclude(i => i.CustomerDebt)
            .FirstOrDefaultAsync(l => l.Id == loanId, cancellationToken)
            ?? throw new NotFoundException("ההשאלה לא נמצאה");

        var item = entity.Items.FirstOrDefault(i => i.Id == itemId)
            ?? throw new NotFoundException("פריט ההשאלה לא נמצא");

        if (item.ReturnedAt == null)
        {
            var stamp = DateTime.UtcNow;
            var hebrew = (dto.HebrewReturnedDisplay ?? string.Empty).Trim();
            item.ReturnedAt = stamp;
            item.HebrewReturnedDisplay = hebrew;
            entity.UpdatedAt = stamp;
            ApplyReturnCharge(entity, item, dto.ChargeAmount, stamp);

            if (entity.Items.All(i => i.ReturnedAt != null))
            {
                entity.ReturnedAt = stamp;
                entity.HebrewReturnedDisplay = hebrew;
            }

            await _db.SaveChangesAsync(cancellationToken);
        }

        return ToDto(entity);
    }

    public async Task<ToolLoanDto> UndoItemReturnAsync(
        int loanId,
        int itemId,
        CancellationToken cancellationToken = default)
    {
        var entity = await _db.ToolLoans
            .Include(l => l.Items)
                .ThenInclude(i => i.CustomerDebt)
            .FirstOrDefaultAsync(l => l.Id == loanId, cancellationToken)
            ?? throw new NotFoundException("ההשאלה לא נמצאה");

        var item = entity.Items.FirstOrDefault(i => i.Id == itemId)
            ?? throw new NotFoundException("פריט ההשאלה לא נמצא");

        if (item.ReturnedAt == null)
        {
            throw new ValidationException("הפריט אינו מסומן כהוחזר");
        }

        var serialLower = item.SerialCode.ToLowerInvariant();
        var alreadyOutElsewhere = await _db.ToolLoanItems
            .AsNoTracking()
            .AnyAsync(
                i => i.Id != item.Id &&
                     i.ToolDefinitionId == item.ToolDefinitionId &&
                     i.SerialCode.ToLower() == serialLower &&
                     i.ReturnedAt == null,
                cancellationToken);

        if (alreadyOutElsewhere)
        {
            throw new ValidationException(
                $"לא ניתן לבטל החזרה — קוד {item.SerialCode} כבר מושאל בהשאלה אחרת");
        }

        // Remove debt/charge created for this return (if any).
        if (item.CustomerDebt != null)
        {
            _db.CustomerDebts.Remove(item.CustomerDebt);
            item.CustomerDebt = null;
        }

        item.ReturnedAt = null;
        item.HebrewReturnedDisplay = null;
        item.ChargeAmount = null;

        // Loan is active again whenever any item is open.
        entity.ReturnedAt = null;
        entity.HebrewReturnedDisplay = null;
        entity.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(entity);
    }

    public async Task DeleteAsync(int loanId, CancellationToken cancellationToken = default)
    {
        var entity = await _db.ToolLoans
            .Include(l => l.Items)
                .ThenInclude(i => i.CustomerDebt)
            .FirstOrDefaultAsync(l => l.Id == loanId, cancellationToken)
            ?? throw new NotFoundException("ההשאלה לא נמצאה");

        // Remove any debts tied to this loan's items so no ghost charges remain.
        foreach (var item in entity.Items)
        {
            if (item.CustomerDebt != null)
            {
                _db.CustomerDebts.Remove(item.CustomerDebt);
            }
        }

        _db.ToolLoans.Remove(entity);
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task<ToolLoanDto> ReturnByCodeAsync(
        ToolLoanReturnByCodeDto dto,
        CancellationToken cancellationToken = default)
    {
        var serial = (dto.SerialCode ?? string.Empty).Trim();
        if (dto.ToolDefinitionId <= 0)
        {
            throw new ValidationException("יש לבחור סוג כלי");
        }

        if (string.IsNullOrEmpty(serial))
        {
            throw new ValidationException("יש להזין קוד פריט");
        }

        var serialLower = serial.ToLowerInvariant();

        // Single tracked lookup for the active (unreturned) item.
        var item = await _db.ToolLoanItems
            .Include(i => i.CustomerDebt)
            .Include(i => i.ToolLoan)
                .ThenInclude(l => l.Items)
                    .ThenInclude(i => i.CustomerDebt)
            .Where(i =>
                i.ToolDefinitionId == dto.ToolDefinitionId &&
                i.ReturnedAt == null &&
                i.SerialCode.ToLower() == serialLower)
            .OrderByDescending(i => i.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (item == null)
        {
            throw new ValidationException("הפריט אינו מסומן כמושאל כרגע");
        }

        var stamp = DateTime.UtcNow;
        var hebrew = (dto.HebrewReturnedDisplay ?? string.Empty).Trim();
        item.ReturnedAt = stamp;
        item.HebrewReturnedDisplay = hebrew;
        item.ToolLoan.UpdatedAt = stamp;
        ApplyReturnCharge(item.ToolLoan, item, dto.ChargeAmount, stamp);

        if (item.ToolLoan.Items.All(i => i.ReturnedAt != null))
        {
            item.ToolLoan.ReturnedAt = stamp;
            item.ToolLoan.HebrewReturnedDisplay = hebrew;
        }

        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(item.ToolLoan);
    }

    public async Task<List<ToolItemBorrowHistoryDto>> GetItemBorrowHistoryAsync(
        int toolDefinitionId,
        string serialCode,
        CancellationToken cancellationToken = default)
    {
        var serial = (serialCode ?? string.Empty).Trim();
        if (toolDefinitionId <= 0)
        {
            throw new ValidationException("יש לבחור סוג כלי");
        }

        if (string.IsNullOrEmpty(serial))
        {
            throw new ValidationException("יש להזין קוד פריט");
        }

        var serialLower = serial.ToLowerInvariant();

        // One AsNoTracking query — completed returns only, newest first (ReturnedAt DESC).
        return await _db.ToolLoanItems
            .AsNoTracking()
            .Include(i => i.CustomerDebt)
            .Where(i =>
                i.ToolDefinitionId == toolDefinitionId &&
                i.ReturnedAt != null &&
                i.SerialCode.ToLower() == serialLower)
            .OrderByDescending(i => i.ReturnedAt)
            .ThenByDescending(i => i.Id)
            .Select(i => new ToolItemBorrowHistoryDto
            {
                LoanId = i.ToolLoanId,
                ItemId = i.Id,
                ToolDefinitionId = i.ToolDefinitionId,
                ToolName = i.ToolName,
                SerialCode = i.SerialCode,
                ClientName = i.ToolLoan.ClientName,
                Phone = i.ToolLoan.Phone,
                LentAt = i.ToolLoan.LentAt,
                HebrewLentDisplay = i.ToolLoan.HebrewLentDisplay,
                DeadlineAt = i.ToolLoan.DeadlineAt,
                ReturnedAt = i.ReturnedAt!.Value,
                HebrewReturnedDisplay = i.HebrewReturnedDisplay,
                ChargeAmount = i.ChargeAmount,
                ChargeIsPaid = i.CustomerDebt != null ? i.CustomerDebt.IsPaid : null,
                CustomerDebtId = i.CustomerDebt != null ? i.CustomerDebt.Id : null
            })
            .ToListAsync(cancellationToken);
    }

    private static void ApplyReturnCharge(
        ToolLoan loan,
        ToolLoanItem item,
        decimal? chargeAmount,
        DateTime stamp)
    {
        var amount = chargeAmount ?? 0m;
        if (amount < 0)
        {
            throw new ValidationException("סכום חיוב לא יכול להיות שלילי");
        }

        if (amount == 0m)
        {
            item.ChargeAmount = null;
            return;
        }

        item.ChargeAmount = amount;
        if (item.CustomerDebt != null)
        {
            item.CustomerDebt.Amount = amount;
            item.CustomerDebt.ChargedAt = stamp;
            item.CustomerDebt.SessionKey = OpenDebtService.BuildSessionKey(
                loan.Phone,
                stamp,
                DebtCategory.Tools);
            item.CustomerDebt.CustomerName = loan.ClientName;
            item.CustomerDebt.Phone = loan.Phone;
            item.CustomerDebt.ItemDescription = item.ToolName;
            return;
        }

        item.CustomerDebt = new CustomerDebt
        {
            CustomerName = loan.ClientName,
            Phone = loan.Phone,
            Amount = amount,
            IsPaid = false,
            Category = DebtCategory.Tools,
            ItemDescription = item.ToolName,
            ChargedAt = stamp,
            SessionKey = OpenDebtService.BuildSessionKey(loan.Phone, stamp, DebtCategory.Tools),
            ToolLoanItem = item
        };
    }

    private static ToolLoanDto ToDto(ToolLoan entity)
    {
        return new ToolLoanDto
        {
            Id = entity.Id,
            LentAt = entity.LentAt,
            HebrewLentDisplay = entity.HebrewLentDisplay,
            ClientName = entity.ClientName,
            Phone = entity.Phone,
            Phone2 = entity.Phone2,
            Address = entity.Address,
            Deposit = entity.Deposit,
            Notes = entity.Notes,
            DeadlineAt = entity.DeadlineAt,
            ReturnedAt = entity.ReturnedAt,
            HebrewReturnedDisplay = entity.HebrewReturnedDisplay,
            Items = entity.Items
                .OrderBy(i => i.Id)
                .Select(i => new ToolLoanItemDto
                {
                    Id = i.Id,
                    ToolDefinitionId = i.ToolDefinitionId,
                    ToolName = i.ToolName,
                    SerialCode = i.SerialCode,
                    ReturnedAt = i.ReturnedAt,
                    HebrewReturnedDisplay = i.HebrewReturnedDisplay,
                    ChargeAmount = i.ChargeAmount,
                    ChargeIsPaid = i.CustomerDebt?.IsPaid,
                    CustomerDebtId = i.CustomerDebt?.Id
                })
                .ToList()
        };
    }
}
