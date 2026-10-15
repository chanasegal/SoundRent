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

    Task SyncForOrderAsync(Order order, CancellationToken cancellationToken = default);
    Task SyncForToolLoanAsync(ToolLoan loan, CancellationToken cancellationToken = default);
    Task SyncForBookLoanAsync(BookLoan loan, CancellationToken cancellationToken = default);
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
            await _db.SaveChangesAsync(cancellationToken);
        }

        return ToDto(deposit);
    }

    public Task SyncForOrderAsync(Order order, CancellationToken cancellationToken = default) =>
        SyncAsync(
            d => d.OrderId == order.Id,
            d => d.OrderId = order.Id,
            order.DepositType == DepositType.Cash ? order.CashDepositAmount : null,
            order.CustomerName,
            order.Phone,
            order.Address,
            order.SystemType,
            order.DepositOnName,
            cancellationToken);

    public Task SyncForToolLoanAsync(ToolLoan loan, CancellationToken cancellationToken = default) =>
        SyncAsync(
            d => d.ToolLoanId == loan.Id,
            d => d.ToolLoanId = loan.Id,
            loan.CashDepositAmount,
            loan.ClientName,
            loan.Phone,
            loan.Address,
            SystemType.Tools,
            loan.Deposit,
            cancellationToken);

    public Task SyncForBookLoanAsync(BookLoan loan, CancellationToken cancellationToken = default) =>
        SyncAsync(
            d => d.BookLoanId == loan.Id,
            d => d.BookLoanId = loan.Id,
            loan.CashDepositAmount,
            loan.ClientName,
            loan.Phone,
            loan.Address,
            SystemType.Library,
            loan.Deposit,
            cancellationToken);

    /// <summary>
    /// Creates, updates or removes the Open ledger row for one source. A row already marked
    /// Returned is never touched, so re-saving a loan cannot resurrect a refunded deposit.
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
        else if (existing.Status == CashDepositStatus.Returned)
        {
            return;
        }
        else if (!hasDeposit)
        {
            _db.CashDeposits.Remove(existing);
            await _db.SaveChangesAsync(cancellationToken);
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
