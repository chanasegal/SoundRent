using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.PhoneNumbers;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Application.Services;

public interface ICashDepositService
{
    Task<List<CashDepositDto>> GetAsync(
        CashDepositStatus? status,
        string? phone,
        CancellationToken cancellationToken = default);

    Task<CashDepositDto> MarkReturnedAsync(int id, CancellationToken cancellationToken = default);

    /// <summary>
    /// Removes a ledger row and clears cash-deposit amount / returned flag on the linked order or loan.
    /// </summary>
    Task DeleteAsync(int id, CancellationToken cancellationToken = default);

    /// <summary>Toggles returned status for the cash deposit of one order / tool loan / book loan.</summary>
    Task<DepositReturnedResultDto> SetReturnedBySourceAsync(
        SetDepositReturnedDto dto,
        CancellationToken cancellationToken = default);

    Task SyncForOrderAsync(Order order, CancellationToken cancellationToken = default);
    Task SyncForToolLoanAsync(ToolLoan loan, CancellationToken cancellationToken = default);
    Task SyncForBookLoanAsync(BookLoan loan, CancellationToken cancellationToken = default);

    /// <summary>
    /// After Sync, applies <paramref name="requestedReturned"/> (when provided) to the order flag
    /// and aligns the ledger row (mark returned / reopen).
    /// </summary>
    Task ApplyOrderDepositReturnedAsync(
        Order order,
        bool? requestedReturned,
        CancellationToken cancellationToken = default);

    Task ApplyToolLoanDepositReturnedAsync(
        ToolLoan loan,
        bool? requestedReturned,
        CancellationToken cancellationToken = default);

    Task ApplyBookLoanDepositReturnedAsync(
        BookLoan loan,
        bool? requestedReturned,
        CancellationToken cancellationToken = default);
}

/// <summary>
/// Central cash-deposit ledger. Loan / order saves call the Sync* methods so every cash deposit
/// gets exactly one ledger row per source; the row stays Open until staff mark it returned.
/// </summary>
public class CashDepositService : ICashDepositService
{
    public const string AmountRequiredMessage = "יש להזין סכום פיקדון במזומן";
    public const string AmountInvalidMessage = "סכום הפיקדון במזומן חייב להיות גדול מאפס";

    private readonly AppDbContext _db;

    public CashDepositService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<List<CashDepositDto>> GetAsync(
        CashDepositStatus? status,
        string? phone,
        CancellationToken cancellationToken = default)
    {
        var query = _db.CashDeposits.AsNoTracking().AsQueryable();

        if (status is { } s)
        {
            query = query.Where(d => d.Status == s);
        }

        var digits = PhoneNumberNormalizer.DigitsOnly(phone);
        if (digits.Length > 0)
        {
            query = query.Where(d => d.Phone == digits);
        }

        var rows = await query
            .OrderByDescending(d => d.Status == CashDepositStatus.Returned ? d.ReturnedAt : d.ReceivedAt)
            .ThenByDescending(d => d.Id)
            .ToListAsync(cancellationToken);

        return rows.Select(ToDto).ToList();
    }

    public async Task<CashDepositDto> MarkReturnedAsync(int id, CancellationToken cancellationToken = default)
    {
        if (id <= 0)
        {
            throw new ValidationException("מזהה פיקדון לא תקין");
        }

        var deposit = await _db.CashDeposits.FirstOrDefaultAsync(d => d.Id == id, cancellationToken)
            ?? throw new NotFoundException("הפיקדון לא נמצא");

        if (deposit.Status != CashDepositStatus.Returned)
        {
            deposit.Status = CashDepositStatus.Returned;
            deposit.ReturnedAt = DateTime.UtcNow;
            await SyncSourceDepositReturnedFlagAsync(deposit, returned: true, cancellationToken);
            await _db.SaveChangesAsync(cancellationToken);
        }

        return ToDto(deposit);
    }

    public async Task DeleteAsync(int id, CancellationToken cancellationToken = default)
    {
        if (id <= 0)
        {
            throw new ValidationException("מזהה פיקדון לא תקין");
        }

        var deposit = await _db.CashDeposits.FirstOrDefaultAsync(d => d.Id == id, cancellationToken)
            ?? throw new NotFoundException("הפיקדון לא נמצא");

        await ClearSourceCashDepositAsync(deposit, cancellationToken);
        _db.CashDeposits.Remove(deposit);
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task<DepositReturnedResultDto> SetReturnedBySourceAsync(
        SetDepositReturnedDto dto,
        CancellationToken cancellationToken = default)
    {
        var sources = (dto.OrderId is > 0 ? 1 : 0)
            + (dto.ToolLoanId is > 0 ? 1 : 0)
            + (dto.BookLoanId is > 0 ? 1 : 0);
        if (sources != 1)
        {
            throw new ValidationException("יש לציין הזמנה או השאלה אחת לסימון הפיקדון");
        }

        if (dto.OrderId is > 0)
        {
            var order = await _db.Orders.FirstOrDefaultAsync(o => o.Id == dto.OrderId, cancellationToken)
                ?? throw new NotFoundException("ההזמנה לא נמצאה");
            await ApplyOrderDepositReturnedAsync(order, dto.Returned, cancellationToken);
            var deposit = await FindDepositAsync(d => d.OrderId == order.Id, cancellationToken);
            return new DepositReturnedResultDto
            {
                DepositReturned = order.DepositReturned,
                Deposit = deposit is null ? null : ToDto(deposit)
            };
        }

        if (dto.ToolLoanId is > 0)
        {
            var loan = await _db.ToolLoans.FirstOrDefaultAsync(l => l.Id == dto.ToolLoanId, cancellationToken)
                ?? throw new NotFoundException("ההשאלה לא נמצאה");
            await ApplyToolLoanDepositReturnedAsync(loan, dto.Returned, cancellationToken);
            var deposit = await FindDepositAsync(d => d.ToolLoanId == loan.Id, cancellationToken);
            return new DepositReturnedResultDto
            {
                DepositReturned = loan.DepositReturned,
                Deposit = deposit is null ? null : ToDto(deposit)
            };
        }

        var bookLoan = await _db.BookLoans.FirstOrDefaultAsync(l => l.Id == dto.BookLoanId, cancellationToken)
            ?? throw new NotFoundException("ההשאלה לא נמצאה");
        await ApplyBookLoanDepositReturnedAsync(bookLoan, dto.Returned, cancellationToken);
        var bookDeposit = await FindDepositAsync(d => d.BookLoanId == bookLoan.Id, cancellationToken);
        return new DepositReturnedResultDto
        {
            DepositReturned = bookLoan.DepositReturned,
            Deposit = bookDeposit is null ? null : ToDto(bookDeposit)
        };
    }

    public async Task SyncForOrderAsync(Order order, CancellationToken cancellationToken = default)
    {
        await SyncAsync(
            d => d.OrderId == order.Id,
            d => d.OrderId = order.Id,
            order.DepositType == DepositType.Cash ? order.CashDepositAmount : null,
            order.CustomerName,
            order.Phone,
            order.Address,
            order.SystemType,
            order.DepositOnName,
            preserveReturned: !order.DepositReturned,
            cancellationToken);
    }

    public async Task SyncForToolLoanAsync(ToolLoan loan, CancellationToken cancellationToken = default)
    {
        await SyncAsync(
            d => d.ToolLoanId == loan.Id,
            d => d.ToolLoanId = loan.Id,
            loan.CashDepositAmount,
            loan.ClientName,
            loan.Phone,
            loan.Address,
            SystemType.Tools,
            loan.Deposit,
            preserveReturned: !loan.DepositReturned,
            cancellationToken);
    }

    public async Task SyncForBookLoanAsync(BookLoan loan, CancellationToken cancellationToken = default)
    {
        await SyncAsync(
            d => d.BookLoanId == loan.Id,
            d => d.BookLoanId = loan.Id,
            loan.CashDepositAmount,
            loan.ClientName,
            loan.Phone,
            loan.Address,
            SystemType.Library,
            loan.Deposit,
            preserveReturned: !loan.DepositReturned,
            cancellationToken);
    }

    public async Task ApplyOrderDepositReturnedAsync(
        Order order,
        bool? requestedReturned,
        CancellationToken cancellationToken = default)
    {
        var hasCash = order.DepositType == DepositType.Cash && order.CashDepositAmount is > 0;
        if (requestedReturned is bool requested)
        {
            order.DepositReturned = hasCash && requested;
        }
        else if (!hasCash)
        {
            order.DepositReturned = false;
        }

        await AlignLedgerToFlagAsync(
            d => d.OrderId == order.Id,
            order.DepositReturned,
            cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task ApplyToolLoanDepositReturnedAsync(
        ToolLoan loan,
        bool? requestedReturned,
        CancellationToken cancellationToken = default)
    {
        var hasCash = loan.CashDepositAmount is > 0;
        if (requestedReturned is bool requested)
        {
            loan.DepositReturned = hasCash && requested;
        }
        else if (!hasCash)
        {
            loan.DepositReturned = false;
        }

        await AlignLedgerToFlagAsync(
            d => d.ToolLoanId == loan.Id,
            loan.DepositReturned,
            cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task ApplyBookLoanDepositReturnedAsync(
        BookLoan loan,
        bool? requestedReturned,
        CancellationToken cancellationToken = default)
    {
        var hasCash = loan.CashDepositAmount is > 0;
        if (requestedReturned is bool requested)
        {
            loan.DepositReturned = hasCash && requested;
        }
        else if (!hasCash)
        {
            loan.DepositReturned = false;
        }

        await AlignLedgerToFlagAsync(
            d => d.BookLoanId == loan.Id,
            loan.DepositReturned,
            cancellationToken);
        await _db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Creates, updates or removes the Open ledger row for one source.
    /// When <paramref name="preserveReturned"/> is true, a Returned row is left untouched
    /// (classic "re-save must not reopen"). When false, Returned rows may be updated/reopened
    /// by a later <see cref="AlignLedgerToFlagAsync"/> call.
    /// </summary>
    private async Task SyncAsync(
        Expression<Func<CashDeposit, bool>> sourceFilter,
        Action<CashDeposit> assignSource,
        decimal? amount,
        string? customerName,
        string phone,
        string? address,
        SystemType module,
        string? notes,
        bool preserveReturned,
        CancellationToken cancellationToken)
    {
        var existing = await _db.CashDeposits
            .Where(sourceFilter)
            .OrderByDescending(d => d.Id)
            .FirstOrDefaultAsync(cancellationToken);

        var hasDeposit = amount is > 0;

        if (existing is null)
        {
            if (!hasDeposit)
            {
                return;
            }

            existing = new CashDeposit
            {
                ReceivedAt = DateTime.UtcNow,
                Status = CashDepositStatus.Open
            };
            assignSource(existing);
            _db.CashDeposits.Add(existing);
        }
        else if (existing.Status == CashDepositStatus.Returned && preserveReturned)
        {
            return;
        }
        else if (!hasDeposit)
        {
            if (existing.Status != CashDepositStatus.Returned)
            {
                _db.CashDeposits.Remove(existing);
                await _db.SaveChangesAsync(cancellationToken);
            }

            return;
        }

        existing.Amount = amount!.Value;
        existing.CustomerName = Truncate((customerName ?? string.Empty).Trim(), 200);
        existing.Phone = PhoneNumberNormalizer.DigitsOnly(phone);
        existing.Address = NullIfBlank(address, 500);
        existing.SourceModule = module;
        existing.Notes = NullIfBlank(notes, 1000);

        await _db.SaveChangesAsync(cancellationToken);
    }

    private async Task AlignLedgerToFlagAsync(
        Expression<Func<CashDeposit, bool>> sourceFilter,
        bool depositReturned,
        CancellationToken cancellationToken)
    {
        var deposit = await FindDepositAsync(sourceFilter, cancellationToken);
        if (deposit is null)
        {
            return;
        }

        if (depositReturned)
        {
            if (deposit.Status != CashDepositStatus.Returned)
            {
                deposit.Status = CashDepositStatus.Returned;
                deposit.ReturnedAt = DateTime.UtcNow;
            }
        }
        else if (deposit.Status == CashDepositStatus.Returned)
        {
            deposit.Status = CashDepositStatus.Open;
            deposit.ReturnedAt = null;
        }
    }

    private async Task SyncSourceDepositReturnedFlagAsync(
        CashDeposit deposit,
        bool returned,
        CancellationToken cancellationToken)
    {
        if (deposit.OrderId is int orderId)
        {
            var order = await _db.Orders.FirstOrDefaultAsync(o => o.Id == orderId, cancellationToken);
            if (order != null)
            {
                order.DepositReturned = returned
                    && order.DepositType == DepositType.Cash
                    && order.CashDepositAmount is > 0;
            }

            return;
        }

        if (deposit.ToolLoanId is int toolLoanId)
        {
            var loan = await _db.ToolLoans.FirstOrDefaultAsync(l => l.Id == toolLoanId, cancellationToken);
            if (loan != null)
            {
                loan.DepositReturned = returned && loan.CashDepositAmount is > 0;
            }

            return;
        }

        if (deposit.BookLoanId is int bookLoanId)
        {
            var loan = await _db.BookLoans.FirstOrDefaultAsync(l => l.Id == bookLoanId, cancellationToken);
            if (loan != null)
            {
                loan.DepositReturned = returned && loan.CashDepositAmount is > 0;
            }
        }
    }

    /// <summary>
    /// Clears cash deposit fields on the parent so a later Sync does not recreate the ledger row.
    /// </summary>
    private async Task ClearSourceCashDepositAsync(CashDeposit deposit, CancellationToken cancellationToken)
    {
        if (deposit.OrderId is int orderId)
        {
            var order = await _db.Orders.FirstOrDefaultAsync(o => o.Id == orderId, cancellationToken);
            if (order != null)
            {
                if (order.DepositType == DepositType.Cash)
                {
                    order.DepositType = null;
                }

                order.CashDepositAmount = null;
                order.DepositReturned = false;
            }

            return;
        }

        if (deposit.ToolLoanId is int toolLoanId)
        {
            var loan = await _db.ToolLoans.FirstOrDefaultAsync(l => l.Id == toolLoanId, cancellationToken);
            if (loan != null)
            {
                loan.CashDepositAmount = null;
                loan.DepositReturned = false;
            }

            return;
        }

        if (deposit.BookLoanId is int bookLoanId)
        {
            var loan = await _db.BookLoans.FirstOrDefaultAsync(l => l.Id == bookLoanId, cancellationToken);
            if (loan != null)
            {
                loan.CashDepositAmount = null;
                loan.DepositReturned = false;
            }
        }
    }

    private Task<CashDeposit?> FindDepositAsync(
        Expression<Func<CashDeposit, bool>> sourceFilter,
        CancellationToken cancellationToken) =>
        _db.CashDeposits
            .Where(sourceFilter)
            .OrderByDescending(d => d.Id)
            .FirstOrDefaultAsync(cancellationToken);

    /// <summary>
    /// A cash deposit must carry an amount. Orders saved as Cash before amounts were tracked
    /// (<paramref name="existing"/> is Cash with no amount) may still be edited without one.
    /// </summary>
    public static void EnsureOrderCashDepositAmount(OrderCreateUpdateDto dto, Order? existing)
    {
        if (dto.DepositType != DepositType.Cash || dto.CashDepositAmount is > 0)
        {
            return;
        }

        var legacyCashOrder = existing is { DepositType: DepositType.Cash, CashDepositAmount: null };
        if (!legacyCashOrder)
        {
            throw new ValidationException(AmountRequiredMessage);
        }
    }

    public static string ModuleLabel(SystemType module) => module switch
    {
        SystemType.Tools => "כלי עבודה",
        SystemType.Library => "ספריה",
        _ => "הגברה"
    };

    private static CashDepositDto ToDto(CashDeposit d) => new()
    {
        Id = d.Id,
        CustomerName = d.CustomerName,
        Phone = d.Phone,
        Address = d.Address,
        Amount = d.Amount,
        ReceivedAt = d.ReceivedAt,
        SourceModule = d.SourceModule,
        SourceModuleLabel = ModuleLabel(d.SourceModule),
        OrderId = d.OrderId,
        ToolLoanId = d.ToolLoanId,
        BookLoanId = d.BookLoanId,
        SourceReference = d.OrderId is int orderId
            ? $"הזמנה #{orderId}"
            : d.ToolLoanId is int toolLoanId
                ? $"השאלה #{toolLoanId}"
                : d.BookLoanId is int bookLoanId
                    ? $"השאלה #{bookLoanId}"
                    : string.Empty,
        Status = d.Status,
        ReturnedAt = d.ReturnedAt,
        Notes = d.Notes
    };

    private static string? NullIfBlank(string? value, int maxLength)
    {
        var trimmed = (value ?? string.Empty).Trim();
        return trimmed.Length == 0 ? null : Truncate(trimmed, maxLength);
    }

    private static string Truncate(string value, int maxLength) =>
        value.Length <= maxLength ? value : value[..maxLength];
}
