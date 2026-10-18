using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Mapping;
using SoundRent.Api.Application.PhoneNumbers;
using SoundRent.Api.Application.Validation;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Application.Services;

public interface IToolLoanService
{
    Task<List<ToolLoanDto>> GetActiveAsync(CancellationToken cancellationToken = default);
    Task<List<ToolLoanDto>> GetAllAsync(bool? returnedOnly = null, CancellationToken cancellationToken = default);
    Task<List<ToolLoanDto>> GetByCustomerPhoneAsync(string phone, CancellationToken cancellationToken = default);
    Task<ToolLoanDto> RenewAsync(int id, CancellationToken cancellationToken = default);
    Task<ToolLoanDto> CreateAsync(ToolLoanCreateDto dto, CancellationToken cancellationToken = default);
    Task<ToolLoanDto> UpdateAsync(int id, ToolLoanCreateDto dto, CancellationToken cancellationToken = default);
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
    private readonly IInstitutionRepository _institutions;
    private readonly ICashDepositService _cashDeposits;

    public ToolLoanService(
        AppDbContext db,
        IInstitutionRepository institutions,
        ICashDepositService cashDeposits)
    {
        _db = db;
        _institutions = institutions;
        _cashDeposits = cashDeposits;
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
        var raw = Uri.UnescapeDataString(phone ?? string.Empty);
        var normalizedPhone = PhoneNumberNormalizer.DigitsOnly(raw);
        if (string.IsNullOrWhiteSpace(normalizedPhone))
        {
            return [];
        }

        var toolRows = await _db.ToolLoans
            .AsNoTracking()
            .Include(l => l.Items)
                .ThenInclude(i => i.CustomerDebt)
            .Where(l => l.Phone == normalizedPhone)
            .ToListAsync(cancellationToken);

        // Standalone השאלת אביזרים orders (Tools system, no weekly-board equipment).
        var accessoryOrders = await _db.Orders
            .AsNoTracking()
            .Include(o => o.Shifts)
            .Include(o => o.Equipments)
            .Include(o => o.LoanedEquipments)
                .ThenInclude(le => le.Notes)
            .Include(o => o.LoanedEquipments)
                .ThenInclude(le => le.InventoryDefinition)
            .Where(o =>
                !o.IsCancelled
                && o.SystemType == SystemType.Tools
                && !o.Equipments.Any()
                && o.LoanedEquipments.Any()
                && (o.Phone == normalizedPhone
                    || (o.Phone2 != null && o.Phone2 == normalizedPhone)))
            .AsSplitQuery()
            .ToListAsync(cancellationToken);

        var combined = toolRows
            .Select(ToDto)
            .Concat(accessoryOrders.Select(ToAccessoryLoanDto))
            .OrderByDescending(l => l.LentAt)
            .ThenByDescending(l => l.Id)
            .ToList();

        return combined;
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
        if (!IsraeliPhoneValidator.TryNormalizeRequired(dto.Phone, out var phone))
        {
            throw new ValidationException(IsraeliPhoneValidator.InvalidPhoneMessage);
        }

        if (!IsraeliPhoneValidator.TryNormalizeOptional(dto.Phone2, out var phone2))
        {
            throw new ValidationException(IsraeliPhoneValidator.InvalidPhoneMessage);
        }

        var items = dto.Items ?? [];
        if (items.Count == 0)
        {
            throw new ValidationException("יש לבחור לפחות כלי אחד להשאלה");
        }

        var normalizedItems = await NormalizeLoanItemsAsync(items, excludeLoanId: null, cancellationToken);
        var (institutionId, institutionName) = await ResolveInstitutionAsync(dto, cancellationToken);

        var now = DateTime.UtcNow;
        var entity = new ToolLoan
        {
            LentAt = now,
            HebrewLentDisplay = (dto.HebrewLentDisplay ?? string.Empty).Trim(),
            ClientName = (dto.ClientName ?? string.Empty).Trim(),
            Phone = phone,
            Phone2 = phone2,
            Address = string.IsNullOrWhiteSpace(dto.Address) ? null : dto.Address.Trim(),
            InstitutionId = institutionId,
            InstitutionName = institutionName,
            Deposit = string.IsNullOrWhiteSpace(dto.Deposit) ? null : dto.Deposit.Trim(),
            CashDepositAmount = dto.CashDepositAmount is > 0 ? dto.CashDepositAmount : null,
            Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim(),
            DeadlineAt = dto.DeadlineAt,
            CreatedAt = now,
            UpdatedAt = now,
            Items = normalizedItems
                .Select(i => new ToolLoanItem
                {
                    ToolDefinitionId = i.ToolDefinitionId,
                    ToolName = i.ToolName,
                    SerialCode = i.SerialCode,
                    AddedAt = now
                })
                .ToList()
        };

        _db.ToolLoans.Add(entity);
        await _db.SaveChangesAsync(cancellationToken);
        await _cashDeposits.SyncForToolLoanAsync(entity, cancellationToken);
        return ToDto(entity);
    }

    public async Task<ToolLoanDto> UpdateAsync(
        int id,
        ToolLoanCreateDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await _db.ToolLoans
            .Include(l => l.Items)
                .ThenInclude(i => i.CustomerDebt)
            .FirstOrDefaultAsync(l => l.Id == id, cancellationToken)
            ?? throw new NotFoundException("ההשאלה לא נמצאה");

        if (entity.ReturnedAt != null)
        {
            throw new ValidationException("לא ניתן לערוך השאלה שכבר הוחזרה במלואה");
        }

        if (!IsraeliPhoneValidator.TryNormalizeRequired(dto.Phone, out var phone))
        {
            throw new ValidationException(IsraeliPhoneValidator.InvalidPhoneMessage);
        }

        if (!IsraeliPhoneValidator.TryNormalizeOptional(dto.Phone2, out var phone2))
        {
            throw new ValidationException(IsraeliPhoneValidator.InvalidPhoneMessage);
        }

        var items = dto.Items ?? [];
        if (items.Count == 0)
        {
            throw new ValidationException("יש לבחור לפחות כלי אחד להשאלה");
        }

        var normalizedItems = await NormalizeLoanItemsAsync(items, excludeLoanId: id, cancellationToken);
        var (institutionId, institutionName) = await ResolveInstitutionAsync(dto, cancellationToken);

        entity.ClientName = (dto.ClientName ?? string.Empty).Trim();
        entity.Phone = phone;
        entity.Phone2 = phone2;
        entity.Address = string.IsNullOrWhiteSpace(dto.Address) ? null : dto.Address.Trim();
        entity.InstitutionId = institutionId;
        entity.InstitutionName = institutionName;
        entity.Deposit = string.IsNullOrWhiteSpace(dto.Deposit) ? null : dto.Deposit.Trim();
        entity.CashDepositAmount = dto.CashDepositAmount is > 0 ? dto.CashDepositAmount : null;
        entity.Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim();
        entity.HebrewLentDisplay = (dto.HebrewLentDisplay ?? string.Empty).Trim();
        var now = DateTime.UtcNow;
        entity.DeadlineAt = dto.DeadlineAt;
        entity.UpdatedAt = now;

        var unreturned = entity.Items.Where(i => i.ReturnedAt == null).ToList();
        var priorAddedAt = new Dictionary<(int ToolDefinitionId, string SerialCode, string ToolName), Queue<DateTime>>();
        foreach (var item in unreturned.OrderBy(i => i.AddedAt))
        {
            var key = ToolItemMatchKey(item.ToolDefinitionId, item.SerialCode, item.ToolName);
            if (!priorAddedAt.TryGetValue(key, out var stamps))
            {
                stamps = new Queue<DateTime>();
                priorAddedAt[key] = stamps;
            }

            stamps.Enqueue(item.AddedAt);

            if (item.CustomerDebt != null)
            {
                _db.CustomerDebts.Remove(item.CustomerDebt);
            }

            _db.ToolLoanItems.Remove(item);
        }

        foreach (var item in normalizedItems)
        {
            var key = ToolItemMatchKey(item.ToolDefinitionId, item.SerialCode, item.ToolName);
            entity.Items.Add(new ToolLoanItem
            {
                ToolDefinitionId = item.ToolDefinitionId,
                ToolName = item.ToolName,
                SerialCode = item.SerialCode,
                AddedAt = priorAddedAt.TryGetValue(key, out var stamps) && stamps.Count > 0
                    ? stamps.Dequeue()
                    : now
            });
        }

        await _db.SaveChangesAsync(cancellationToken);
        await _cashDeposits.SyncForToolLoanAsync(entity, cancellationToken);
        return ToDto(entity);
    }

    private static (int ToolDefinitionId, string SerialCode, string ToolName) ToolItemMatchKey(
        int toolDefinitionId,
        string? serialCode,
        string? toolName) =>
        (
            toolDefinitionId,
            (serialCode ?? string.Empty).Trim().ToUpperInvariant(),
            toolDefinitionId > 0 ? string.Empty : (toolName ?? string.Empty).Trim().ToUpperInvariant()
        );

    private async Task<List<(int ToolDefinitionId, string SerialCode, string ToolName)>> NormalizeLoanItemsAsync(
        List<ToolLoanItemCreateDto> items,
        int? excludeLoanId,
        CancellationToken cancellationToken)
    {
        var normalizedItems = new List<(int ToolDefinitionId, string SerialCode, string ToolName)>();

        foreach (var item in items)
        {
            var serial = (item.SerialCode ?? string.Empty).Trim();

            if (item.ToolDefinitionId <= 0)
            {
                var toolName = (item.ToolName ?? string.Empty).Trim();
                if (string.IsNullOrEmpty(toolName))
                {
                    throw new ValidationException("שם כלי חסר לפריט חד-פעמי");
                }

                if (toolName.Length > 200)
                {
                    throw new ValidationException("שם כלי ארוך מדי");
                }

                if (serial.Length > 100)
                {
                    throw new ValidationException("קוד פריט ארוך מדי");
                }

                normalizedItems.Add((0, serial, toolName));
                continue;
            }

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
                         i.ReturnedAt == null &&
                         (excludeLoanId == null || i.ToolLoanId != excludeLoanId.Value),
                    cancellationToken);

            if (alreadyOut)
            {
                throw new ValidationException($"קוד {serial} כבר מושאל");
            }

            normalizedItems.Add((definition.Id, serial, definition.DisplayName));
        }

        return normalizedItems;
    }

    private async Task<(int? InstitutionId, string? InstitutionName)> ResolveInstitutionAsync(
        ToolLoanCreateDto dto,
        CancellationToken cancellationToken)
    {
        const SystemType systemType = SystemType.Tools;

        if (dto.InstitutionId is int institutionId)
        {
            var institution = await _institutions.GetByIdAsync(institutionId, cancellationToken)
                ?? throw new ValidationException("המוסד שנבחר לא נמצא");
            await _institutions.EnsureSystemLinkAsync(institution.Id, systemType, cancellationToken);
            await _institutions.SaveChangesAsync(cancellationToken);
            return (institution.Id, institution.Name);
        }

        if (!string.IsNullOrWhiteSpace(dto.InstitutionName))
        {
            var name = dto.InstitutionName.Trim();
            var match = await _institutions.FindByNameAsync(name, systemType, cancellationToken)
                ?? await _institutions.FindByNameAsync(name, systemType: null, cancellationToken);
            if (match is not null)
            {
                await _institutions.EnsureSystemLinkAsync(match.Id, systemType, cancellationToken);
                await _institutions.SaveChangesAsync(cancellationToken);
                return (match.Id, match.Name);
            }

            var created = new Institution { Name = name };
            try
            {
                await _institutions.AddAsync(created, cancellationToken);
                await _institutions.SaveChangesAsync(cancellationToken);
                await _institutions.EnsureSystemLinkAsync(created.Id, systemType, cancellationToken);
                await _institutions.SaveChangesAsync(cancellationToken);
                return (created.Id, created.Name);
            }
            catch (DbUpdateException)
            {
                var raced = await _institutions.FindByNameAsync(name, systemType: null, cancellationToken)
                    ?? throw new ValidationException("לא ניתן לשמור את שם המוסד");
                await _institutions.EnsureSystemLinkAsync(raced.Id, systemType, cancellationToken);
                await _institutions.SaveChangesAsync(cancellationToken);
                return (raced.Id, raced.Name);
            }
        }

        return (null, null);
    }

    public async Task<ToolLoanDto> MarkReturnedAsync(
        int id,
        ToolLoanReturnDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await _db.ToolLoans
            .Include(l => l.Items)
                .ThenInclude(i => i.CustomerDebt)
            .FirstOrDefaultAsync(l => l.Id == id, cancellationToken)
            ?? throw new NotFoundException("ההשאלה לא נמצאה");

        var stamp = DateTime.UtcNow;
        var hebrew = (dto.HebrewReturnedDisplay ?? string.Empty).Trim();

        foreach (var item in entity.Items.Where(i => i.ReturnedAt == null))
        {
            item.ReturnedAt = stamp;
            item.HebrewReturnedDisplay = hebrew;
            ApplyReturnCharge(entity, item, dto.ChargeAmount, stamp);
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
                Address = i.ToolLoan.Address,
                LentAt = i.AddedAt,
                HebrewLentDisplay = i.AddedAt == i.ToolLoan.LentAt ? i.ToolLoan.HebrewLentDisplay : string.Empty,
                DeadlineAt = i.ToolLoan.DeadlineAt,
                ReturnedAt = i.ReturnedAt!.Value,
                HebrewReturnedDisplay = i.HebrewReturnedDisplay,
                ChargeAmount = i.ChargeAmount ?? (i.CustomerDebt != null ? i.CustomerDebt.Amount : null),
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
            LoanSource = "tools",
            LentAt = entity.LentAt,
            HebrewLentDisplay = entity.HebrewLentDisplay,
            ClientName = entity.ClientName,
            Phone = entity.Phone,
            Phone2 = entity.Phone2,
            Address = entity.Address,
            InstitutionName = entity.InstitutionName,
            InstitutionId = entity.InstitutionId,
            Deposit = entity.Deposit,
            CashDepositAmount = entity.CashDepositAmount,
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
                    AddedAt = i.AddedAt,
                    ReturnedAt = i.ReturnedAt,
                    HebrewReturnedDisplay = i.HebrewReturnedDisplay,
                    ChargeAmount = i.ChargeAmount ?? i.CustomerDebt?.Amount,
                    ChargeIsPaid = i.CustomerDebt?.IsPaid,
                    CustomerDebtId = i.CustomerDebt?.Id
                })
                .ToList()
        };
    }

    /// <summary>
    /// Maps a standalone accessory-only order into the shared tools customer-history shape.
    /// Prefer per-line <see cref="OrderLoanedEquipment.AddedAt"/> / return stamps so hours and
    /// minutes are preserved — never invent midnight from shift <see cref="DateOnly"/> days.
    /// </summary>
    private static ToolLoanDto ToAccessoryLoanDto(Order order)
    {
        var items = MapAccessoryItems(order);
        var lentAt = items
            .Select(i => i.AddedAt)
            .Where(t => t != default)
            .DefaultIfEmpty(order.CreatedAt)
            .Min();
        var allReturned = items.Count > 0 && items.All(i => i.ReturnedAt != null);
        var returnStamp = allReturned
            ? items.Where(i => i.ReturnedAt != null).Max(i => i.ReturnedAt!.Value)
            : (DateTime?)null;

        return new ToolLoanDto
        {
            Id = order.Id,
            LoanSource = "accessory",
            LentAt = lentAt,
            HebrewLentDisplay = string.Empty,
            ClientName = order.CustomerName ?? string.Empty,
            Phone = order.Phone,
            Phone2 = order.Phone2,
            Address = order.Address,
            InstitutionName = order.InstitutionName,
            InstitutionId = order.InstitutionId,
            Deposit = FormatOrderDeposit(order.DepositType, order.DepositOnName),
            CashDepositAmount = order.CashDepositAmount,
            Notes = order.Notes,
            DeadlineAt = null,
            ReturnedAt = returnStamp,
            HebrewReturnedDisplay = null,
            Items = items
        };
    }

    private static List<ToolLoanItemDto> MapAccessoryItems(Order order)
    {
        var items = new List<ToolLoanItemDto>();
        var returnDay = order.Shifts
            .OrderByDescending(s => s.OrderDate)
            .Select(s => (DateOnly?)s.OrderDate)
            .FirstOrDefault();

        foreach (var le in order.LoanedEquipments.OrderBy(x => x.Id))
        {
            var name = OrderMapper.GetLoanedEquipmentDisplayName(le);
            var defId = le.InventoryDefinitionId ?? 0;
            var addedAt = le.AddedAt != default ? le.AddedAt : order.CreatedAt;
            var notesWithCode = le.Notes
                .Where(n => !string.IsNullOrWhiteSpace(n.Content))
                .OrderBy(n => n.Ordinal)
                .ThenBy(n => n.Id)
                .ToList();

            if (notesWithCode.Count > 0)
            {
                foreach (var note in notesWithCode)
                {
                    items.Add(new ToolLoanItemDto
                    {
                        Id = note.Id,
                        ToolDefinitionId = defId,
                        ToolName = name,
                        SerialCode = note.Content!.Trim(),
                        AddedAt = addedAt,
                        ReturnedAt = note.IsReturned
                            ? note.ReturnedAt ?? ResolveAccessoryHistoryReturnStamp(returnDay, addedAt)
                            : null,
                        HebrewReturnedDisplay = null
                    });
                }

                continue;
            }

            var fullyReturned = le.Quantity > 0 && le.ReturnedQuantity >= le.Quantity;
            var serial = le.Quantity > 1 ? $"×{le.Quantity}" : string.Empty;
            items.Add(new ToolLoanItemDto
            {
                Id = le.Id,
                ToolDefinitionId = defId,
                ToolName = name,
                SerialCode = serial,
                AddedAt = addedAt,
                ReturnedAt = fullyReturned
                    ? le.ReturnedAt ?? ResolveAccessoryHistoryReturnStamp(returnDay, addedAt)
                    : null,
                HebrewReturnedDisplay = null
            });
        }

        return items;
    }

    /// <summary>
    /// Historical accessory rows may lack a stored return stamp. Prefer the real lend
    /// timestamp for same-day unknowns (UI shows a short/unknown duration) and the
    /// calendar return day for multi-day spans — never invent midnight on the loan day.
    /// </summary>
    private static DateTime? ResolveAccessoryHistoryReturnStamp(DateOnly? returnDate, DateTime lentAt)
    {
        var loanUtc = lentAt.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(lentAt, DateTimeKind.Utc)
            : lentAt.ToUniversalTime();
        if (returnDate is null)
        {
            return loanUtc;
        }

        var loanDay = DateOnly.FromDateTime(loanUtc);
        if (returnDate.Value <= loanDay)
        {
            return loanUtc;
        }

        return DateTime.SpecifyKind(
            returnDate.Value.ToDateTime(TimeOnly.MinValue),
            DateTimeKind.Utc);
    }

    private static string? FormatOrderDeposit(DepositType? depositType, string? depositOnName)
    {
        var typeLabel = depositType switch
        {
            DepositType.Check => "צ׳ק",
            DepositType.CreditCard => "אשראי",
            DepositType.Cash => "מזומן",
            _ => null
        };
        var onName = (depositOnName ?? string.Empty).Trim();
        if (typeLabel is null && onName.Length == 0)
        {
            return null;
        }

        if (typeLabel is null)
        {
            return onName;
        }

        return onName.Length > 0 ? $"{typeLabel} — {onName}" : typeLabel;
    }
}
