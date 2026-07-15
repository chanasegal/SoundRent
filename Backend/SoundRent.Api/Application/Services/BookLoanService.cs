using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Application.Services;

public interface IBookLoanService
{
    Task<List<BookLoanDto>> GetActiveAsync(CancellationToken cancellationToken = default);
    Task<List<BookLoanDto>> GetAllAsync(bool? returnedOnly = null, CancellationToken cancellationToken = default);
    Task<BookLoanDto> CreateAsync(BookLoanCreateDto dto, CancellationToken cancellationToken = default);
    Task<BookLoanDto> MarkReturnedAsync(int id, BookLoanReturnDto dto, CancellationToken cancellationToken = default);
    Task<BookLoanDto> MarkItemReturnedAsync(
        int loanId,
        int itemId,
        BookLoanReturnDto dto,
        CancellationToken cancellationToken = default);
    Task<BookLoanDto> UndoItemReturnAsync(
        int loanId,
        int itemId,
        CancellationToken cancellationToken = default);
    Task DeleteAsync(int loanId, CancellationToken cancellationToken = default);
    Task<BookLoanDto> ReturnByCodeAsync(
        BookLoanReturnByCodeDto dto,
        CancellationToken cancellationToken = default);
    Task<List<BookItemBorrowHistoryDto>> GetItemBorrowHistoryAsync(
        int bookId,
        string copyNumber,
        CancellationToken cancellationToken = default);
}

public class BookLoanService : IBookLoanService
{
    private readonly AppDbContext _db;

    public BookLoanService(AppDbContext db)
    {
        _db = db;
    }

    public Task<List<BookLoanDto>> GetActiveAsync(CancellationToken cancellationToken = default)
        => GetAllAsync(returnedOnly: false, cancellationToken);

    public async Task<List<BookLoanDto>> GetAllAsync(
        bool? returnedOnly = null,
        CancellationToken cancellationToken = default)
    {
        var query = _db.BookLoans
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

    public async Task<BookLoanDto> CreateAsync(
        BookLoanCreateDto dto,
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
            throw new ValidationException("יש לבחור לפחות ספר אחד להשאלה");
        }

        var normalizedItems = new List<(int BookId, string CopyNumber, string BookTitle)>();
        var seenCodes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in items)
        {
            var serial = (item.CopyNumber ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(serial))
            {
                throw new ValidationException("קוד עותק חסר");
            }

            if (!seenCodes.Add(serial))
            {
                throw new ValidationException($"קוד עותק {serial} נבחר יותר מפעם אחת");
            }

            var definition = await _db.Books
                .AsNoTracking()
                .Include(t => t.Copies)
                .FirstOrDefaultAsync(t => t.Id == item.BookId, cancellationToken)
                ?? throw new ValidationException($"ספר #{item.BookId} לא נמצא");

            if (!definition.Copies.Any(s => string.Equals(s.CopyNumber, serial, StringComparison.OrdinalIgnoreCase)))
            {
                throw new ValidationException($"קוד {serial} אינו שייך ל־{definition.Title}");
            }

            var alreadyOut = await _db.BookLoanItems
                .AsNoTracking()
                .AnyAsync(
                    i => i.CopyNumber == serial &&
                         i.BookId == definition.Id &&
                         i.ReturnedAt == null,
                    cancellationToken);

            if (alreadyOut)
            {
                throw new ValidationException($"קוד {serial} כבר מושאל");
            }

            normalizedItems.Add((definition.Id, serial, definition.Title));
        }

        var entity = new BookLoan
        {
            LentAt = DateTime.UtcNow,
            HebrewLentDisplay = (dto.HebrewLentDisplay ?? string.Empty).Trim(),
            ClientName = (dto.ClientName ?? string.Empty).Trim(),
            Phone = phone,
            Deposit = string.IsNullOrWhiteSpace(dto.Deposit) ? null : dto.Deposit.Trim(),
            Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim(),
            DeadlineAt = dto.DeadlineAt,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            Items = normalizedItems
                .Select(i => new BookLoanItem
                {
                    BookId = i.BookId,
                    BookTitle = i.BookTitle,
                    CopyNumber = i.CopyNumber
                })
                .ToList()
        };

        _db.BookLoans.Add(entity);
        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(entity);
    }

    public async Task<BookLoanDto> MarkReturnedAsync(
        int id,
        BookLoanReturnDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await _db.BookLoans
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

    public async Task<BookLoanDto> MarkItemReturnedAsync(
        int loanId,
        int itemId,
        BookLoanReturnDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await _db.BookLoans
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

    public async Task<BookLoanDto> UndoItemReturnAsync(
        int loanId,
        int itemId,
        CancellationToken cancellationToken = default)
    {
        var entity = await _db.BookLoans
            .Include(l => l.Items)
                .ThenInclude(i => i.CustomerDebt)
            .FirstOrDefaultAsync(l => l.Id == loanId, cancellationToken)
            ?? throw new NotFoundException("ההשאלה לא נמצאה");

        var item = entity.Items.FirstOrDefault(i => i.Id == itemId)
            ?? throw new NotFoundException("פריט ההשאלה לא נמצא");

        if (item.ReturnedAt == null)
        {
            throw new ValidationException("העותק אינו מסומן כהוחזר");
        }

        var serialLower = item.CopyNumber.ToLowerInvariant();
        var alreadyOutElsewhere = await _db.BookLoanItems
            .AsNoTracking()
            .AnyAsync(
                i => i.Id != item.Id &&
                     i.BookId == item.BookId &&
                     i.CopyNumber.ToLower() == serialLower &&
                     i.ReturnedAt == null,
                cancellationToken);

        if (alreadyOutElsewhere)
        {
            throw new ValidationException(
                $"לא ניתן לבטל החזרה — קוד {item.CopyNumber} כבר מושאל בהשאלה אחרת");
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
        var entity = await _db.BookLoans
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

        _db.BookLoans.Remove(entity);
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task<BookLoanDto> ReturnByCodeAsync(
        BookLoanReturnByCodeDto dto,
        CancellationToken cancellationToken = default)
    {
        var serial = (dto.CopyNumber ?? string.Empty).Trim();
        if (dto.BookId <= 0)
        {
            throw new ValidationException("יש לבחור ספר");
        }

        if (string.IsNullOrEmpty(serial))
        {
            throw new ValidationException("יש להזין קוד עותק");
        }

        var serialLower = serial.ToLowerInvariant();

        // Single tracked lookup for the active (unreturned) item.
        var item = await _db.BookLoanItems
            .Include(i => i.CustomerDebt)
            .Include(i => i.BookLoan)
                .ThenInclude(l => l.Items)
                    .ThenInclude(i => i.CustomerDebt)
            .Where(i =>
                i.BookId == dto.BookId &&
                i.ReturnedAt == null &&
                i.CopyNumber.ToLower() == serialLower)
            .OrderByDescending(i => i.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (item == null)
        {
            throw new ValidationException("העותק אינו מסומן כמושאל כרגע");
        }

        var stamp = DateTime.UtcNow;
        var hebrew = (dto.HebrewReturnedDisplay ?? string.Empty).Trim();
        item.ReturnedAt = stamp;
        item.HebrewReturnedDisplay = hebrew;
        item.BookLoan.UpdatedAt = stamp;
        ApplyReturnCharge(item.BookLoan, item, dto.ChargeAmount, stamp);

        if (item.BookLoan.Items.All(i => i.ReturnedAt != null))
        {
            item.BookLoan.ReturnedAt = stamp;
            item.BookLoan.HebrewReturnedDisplay = hebrew;
        }

        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(item.BookLoan);
    }

    public async Task<List<BookItemBorrowHistoryDto>> GetItemBorrowHistoryAsync(
        int bookId,
        string copyNumber,
        CancellationToken cancellationToken = default)
    {
        var serial = (copyNumber ?? string.Empty).Trim();
        if (bookId <= 0)
        {
            throw new ValidationException("יש לבחור ספר");
        }

        if (string.IsNullOrEmpty(serial))
        {
            throw new ValidationException("יש להזין קוד עותק");
        }

        var serialLower = serial.ToLowerInvariant();

        // One AsNoTracking query — completed returns only, newest first (ReturnedAt DESC).
        return await _db.BookLoanItems
            .AsNoTracking()
            .Include(i => i.CustomerDebt)
            .Where(i =>
                i.BookId == bookId &&
                i.ReturnedAt != null &&
                i.CopyNumber.ToLower() == serialLower)
            .OrderByDescending(i => i.ReturnedAt)
            .ThenByDescending(i => i.Id)
            .Select(i => new BookItemBorrowHistoryDto
            {
                LoanId = i.BookLoanId,
                ItemId = i.Id,
                BookId = i.BookId,
                BookTitle = i.BookTitle,
                CopyNumber = i.CopyNumber,
                ClientName = i.BookLoan.ClientName,
                Phone = i.BookLoan.Phone,
                LentAt = i.BookLoan.LentAt,
                HebrewLentDisplay = i.BookLoan.HebrewLentDisplay,
                DeadlineAt = i.BookLoan.DeadlineAt,
                ReturnedAt = i.ReturnedAt!.Value,
                HebrewReturnedDisplay = i.HebrewReturnedDisplay,
                ChargeAmount = i.ChargeAmount,
                ChargeIsPaid = i.CustomerDebt != null ? i.CustomerDebt.IsPaid : null,
                CustomerDebtId = i.CustomerDebt != null ? i.CustomerDebt.Id : null
            })
            .ToListAsync(cancellationToken);
    }

    private static void ApplyReturnCharge(
        BookLoan loan,
        BookLoanItem item,
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
                DebtCategory.Library);
            item.CustomerDebt.CustomerName = loan.ClientName;
            item.CustomerDebt.Phone = loan.Phone;
            item.CustomerDebt.ItemDescription = item.BookTitle;
            return;
        }

        item.CustomerDebt = new CustomerDebt
        {
            CustomerName = loan.ClientName,
            Phone = loan.Phone,
            Amount = amount,
            IsPaid = false,
            Category = DebtCategory.Library,
            ItemDescription = item.BookTitle,
            ChargedAt = stamp,
            SessionKey = OpenDebtService.BuildSessionKey(loan.Phone, stamp, DebtCategory.Library),
            BookLoanItem = item
        };
    }

    private static BookLoanDto ToDto(BookLoan entity)
    {
        return new BookLoanDto
        {
            Id = entity.Id,
            LentAt = entity.LentAt,
            HebrewLentDisplay = entity.HebrewLentDisplay,
            ClientName = entity.ClientName,
            Phone = entity.Phone,
            Deposit = entity.Deposit,
            Notes = entity.Notes,
            DeadlineAt = entity.DeadlineAt,
            ReturnedAt = entity.ReturnedAt,
            HebrewReturnedDisplay = entity.HebrewReturnedDisplay,
            Items = entity.Items
                .OrderBy(i => i.Id)
                .Select(i => new BookLoanItemDto
                {
                    Id = i.Id,
                    BookId = i.BookId,
                    BookTitle = i.BookTitle,
                    CopyNumber = i.CopyNumber,
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
