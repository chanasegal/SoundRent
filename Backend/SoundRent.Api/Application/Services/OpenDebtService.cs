using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Mapping;
using SoundRent.Api.Application.Validation;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Application.Services;

public interface IOpenDebtService
{
    Task<List<OpenDebtGroupDto>> GetOpenDebtGroupsAsync(CancellationToken cancellationToken = default);
    Task<OpenDebtDetailDto> GetDebtAsync(int debtId, CancellationToken cancellationToken = default);
    Task<CreatedOpenDebtDto> CreateDebtAsync(CreateOpenDebtDto dto, CancellationToken cancellationToken = default);
    Task<CreatedOpenDebtDto> UpdateDebtAsync(int debtId, UpdateOpenDebtDto dto, CancellationToken cancellationToken = default);
    Task<CreatedOpenDebtDto> UpdateOrderDebtAsync(int orderId, UpdateOpenDebtDto dto, CancellationToken cancellationToken = default);
    Task MarkGroupPaidAsync(MarkOpenDebtGroupPaidDto dto, CancellationToken cancellationToken = default);
    Task MarkDebtPaidAsync(int debtId, CancellationToken cancellationToken = default);
    Task DeleteGroupAsync(MarkOpenDebtGroupPaidDto dto, CancellationToken cancellationToken = default);
}

public class OpenDebtService : IOpenDebtService
{
    private readonly AppDbContext _db;
    private readonly IOrderRepository _orders;
    private readonly IOrderService _orderService;
    private readonly ICustomerService _customers;

    public OpenDebtService(
        AppDbContext db,
        IOrderRepository orders,
        IOrderService orderService,
        ICustomerService customers)
    {
        _db = db;
        _orders = orders;
        _orderService = orderService;
        _customers = customers;
    }

    public async Task<List<OpenDebtGroupDto>> GetOpenDebtGroupsAsync(
        CancellationToken cancellationToken = default)
    {
        var lines = new List<(
            string GroupKey,
            string CustomerName,
            string Phone,
            string? Address,
            DebtCategory Category,
            decimal Amount,
            string ItemDescription,
            string? Deposit,
            string? Notes,
            DateTime SessionDate,
            int? DebtId,
            int? OrderId)>();

        var debts = await _db.CustomerDebts
            .AsNoTracking()
            .Where(d => !d.IsPaid && d.Amount > 0)
            .ToListAsync(cancellationToken);

        foreach (var d in debts)
        {
            lines.Add((
                string.IsNullOrWhiteSpace(d.SessionKey)
                    ? BuildSessionKey(d.Phone, d.ChargedAt, d.Category)
                    : d.SessionKey,
                d.CustomerName,
                d.Phone,
                d.Address,
                d.Category,
                d.Amount,
                d.ItemDescription,
                d.Deposit,
                d.Notes,
                d.ChargedAt.Date,
                d.Id,
                null));
        }

        var unpaidOrders = await _orders.GetUnpaidOrdersAsync(cancellationToken);
        foreach (var order in unpaidOrders.Where(o => !o.IsCancelled && o.PaymentAmount is > 0))
        {
            var category = ToDebtCategory(order.SystemType);
            // Charge date = rental start (earliest shift / pickup day), not order creation time.
            var chargeDate = ResolveOrderChargeDate(order);
            var groupKey = BuildSessionKey(order.Phone, chargeDate, category);
            lines.Add((
                groupKey,
                order.CustomerName ?? string.Empty,
                order.Phone,
                order.Address,
                category,
                order.PaymentAmount ?? 0m,
                BuildOrderEquipmentSummary(order),
                FormatOrderDeposit(order),
                order.Notes,
                chargeDate.Date,
                null,
                order.Id));
        }

        return lines
            .GroupBy(l => l.GroupKey)
            .Select(g =>
            {
                var first = g.First();
                var names = g
                    .Select(x => x.ItemDescription.Trim())
                    .Where(s => s.Length > 0)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
                var deposits = g
                    .Select(x => (x.Deposit ?? string.Empty).Trim())
                    .Where(s => s.Length > 0)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
                var notes = g
                    .Select(x => (x.Notes ?? string.Empty).Trim())
                    .Where(s => s.Length > 0)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
                var addresses = g
                    .Select(x => (x.Address ?? string.Empty).Trim())
                    .Where(s => s.Length > 0)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
                return new OpenDebtGroupDto
                {
                    GroupKey = g.Key,
                    CustomerName = g.Select(x => x.CustomerName).FirstOrDefault(n => !string.IsNullOrWhiteSpace(n))
                        ?? first.CustomerName,
                    Phone = first.Phone,
                    Address = addresses.Count == 0 ? null : addresses[0],
                    Category = first.Category,
                    CategoryLabel = CategoryLabel(first.Category),
                    TotalAmount = g.Sum(x => x.Amount),
                    EquipmentSummary = string.Join(", ", names),
                    Deposit = deposits.Count == 0 ? null : string.Join(", ", deposits),
                    Notes = notes.Count == 0 ? null : string.Join(", ", notes),
                    SessionDate = g.Max(x => x.SessionDate),
                    DebtIds = g.Where(x => x.DebtId.HasValue).Select(x => x.DebtId!.Value).Distinct().ToList(),
                    OrderIds = g.Where(x => x.OrderId.HasValue).Select(x => x.OrderId!.Value).Distinct().ToList()
                };
            })
            .Where(g => g.TotalAmount > 0)
            .OrderByDescending(g => g.SessionDate)
            .ThenBy(g => g.CustomerName)
            .ToList();
    }

    public async Task<OpenDebtDetailDto> GetDebtAsync(
        int debtId,
        CancellationToken cancellationToken = default)
    {
        if (debtId <= 0)
        {
            throw new ValidationException("מזהה חוב לא תקין");
        }

        var debt = await _db.CustomerDebts
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == debtId, cancellationToken)
            ?? throw new NotFoundException("החוב לא נמצא");

        return ToDetailDto(debt);
    }

    public async Task<CreatedOpenDebtDto> CreateDebtAsync(
        CreateOpenDebtDto dto,
        CancellationToken cancellationToken = default)
    {
        if (!IsraeliPhoneValidator.TryNormalizeRequired(dto.Phone, out var phone))
        {
            throw new ValidationException(IsraeliPhoneValidator.InvalidPhoneMessage);
        }

        var customerName = (dto.CustomerName ?? string.Empty).Trim();
        var address = (dto.Address ?? string.Empty).Trim();
        var itemDescription = (dto.ItemDescription ?? string.Empty).Trim();
        var deposit = (dto.Deposit ?? string.Empty).Trim();
        var notes = (dto.Notes ?? string.Empty).Trim();

        if (dto.Amount <= 0)
        {
            throw new ValidationException("סכום החוב חייב להיות גדול מאפס");
        }

        if (!Enum.IsDefined(typeof(DebtCategory), dto.Category))
        {
            throw new ValidationException("קטגוריית חוב לא תקינה");
        }

        var chargedAt = ResolveChargeTimestamp(dto.ChargedAt);
        var debt = new CustomerDebt
        {
            CustomerName = customerName,
            Phone = phone,
            Address = address.Length == 0 ? null : address,
            Amount = dto.Amount,
            IsPaid = false,
            Category = dto.Category,
            ItemDescription = itemDescription,
            Deposit = deposit.Length == 0 ? null : deposit,
            Notes = notes.Length == 0 ? null : notes,
            ChargedAt = chargedAt,
            SessionKey = BuildSessionKey(phone, chargedAt, dto.Category)
        };

        _db.CustomerDebts.Add(debt);
        await _db.SaveChangesAsync(cancellationToken);

        await _customers.SyncFromWaitlistAsync(
            phone,
            customerName.Length == 0 ? null : customerName,
            address.Length == 0 ? null : address,
            ToSystemType(dto.Category),
            cancellationToken);

        return await BuildCreatedResultAsync(debt, cancellationToken);
    }

    public async Task<CreatedOpenDebtDto> UpdateDebtAsync(
        int debtId,
        UpdateOpenDebtDto dto,
        CancellationToken cancellationToken = default)
    {
        if (debtId <= 0)
        {
            throw new ValidationException("מזהה חוב לא תקין");
        }

        if (!IsraeliPhoneValidator.TryNormalizeRequired(dto.Phone, out var phone))
        {
            throw new ValidationException(IsraeliPhoneValidator.InvalidPhoneMessage);
        }

        var debt = await _db.CustomerDebts
            .FirstOrDefaultAsync(d => d.Id == debtId, cancellationToken)
            ?? throw new NotFoundException("החוב לא נמצא");

        if (debt.IsPaid)
        {
            throw new ValidationException("לא ניתן לערוך חוב שכבר שולם");
        }

        var customerName = (dto.CustomerName ?? string.Empty).Trim();
        var address = (dto.Address ?? string.Empty).Trim();
        var itemDescription = (dto.ItemDescription ?? string.Empty).Trim();
        var deposit = (dto.Deposit ?? string.Empty).Trim();
        var notes = (dto.Notes ?? string.Empty).Trim();

        if (dto.Amount <= 0)
        {
            throw new ValidationException("סכום החוב חייב להיות גדול מאפס");
        }

        if (!Enum.IsDefined(typeof(DebtCategory), dto.Category))
        {
            throw new ValidationException("קטגוריית חוב לא תקינה");
        }

        var chargedAt = ResolveChargeTimestamp(dto.ChargedAt);
        debt.CustomerName = customerName;
        debt.Phone = phone;
        debt.Address = address.Length == 0 ? null : address;
        debt.Amount = dto.Amount;
        debt.Category = dto.Category;
        debt.ItemDescription = itemDescription;
        debt.Deposit = deposit.Length == 0 ? null : deposit;
        debt.Notes = notes.Length == 0 ? null : notes;
        debt.ChargedAt = chargedAt;
        debt.SessionKey = BuildSessionKey(phone, chargedAt, dto.Category);

        await _db.SaveChangesAsync(cancellationToken);

        await _customers.SyncFromWaitlistAsync(
            phone,
            customerName.Length == 0 ? null : customerName,
            address.Length == 0 ? null : address,
            ToSystemType(dto.Category),
            cancellationToken);

        return await BuildCreatedResultAsync(debt, cancellationToken);
    }

    public async Task<CreatedOpenDebtDto> UpdateOrderDebtAsync(
        int orderId,
        UpdateOpenDebtDto dto,
        CancellationToken cancellationToken = default)
    {
        if (orderId <= 0)
        {
            throw new ValidationException("מזהה הזמנה לא תקין");
        }

        if (!IsraeliPhoneValidator.TryNormalizeRequired(dto.Phone, out var phone))
        {
            throw new ValidationException(IsraeliPhoneValidator.InvalidPhoneMessage);
        }

        if (dto.Amount <= 0)
        {
            throw new ValidationException("סכום החוב חייב להיות גדול מאפס");
        }

        if (!Enum.IsDefined(typeof(DebtCategory), dto.Category))
        {
            throw new ValidationException("קטגוריית חוב לא תקינה");
        }

        var order = await _orders.GetByIdAsync(orderId, cancellationToken)
            ?? throw new NotFoundException("ההזמנה לא נמצאה");

        if (order.IsCancelled)
        {
            throw new ValidationException("לא ניתן לערוך חוב של הזמנה מבוטלת דרך מסך החובות");
        }

        var customerName = (dto.CustomerName ?? string.Empty).Trim();
        var address = (dto.Address ?? string.Empty).Trim();
        var deposit = (dto.Deposit ?? string.Empty).Trim();
        var notes = (dto.Notes ?? string.Empty).Trim();
        var chargedAt = ResolveChargeTimestamp(dto.ChargedAt);
        var chargeDate = DateOnly.FromDateTime(chargedAt);

        order.CustomerName = customerName.Length == 0 ? null : customerName;
        order.Phone = phone;
        order.Address = address.Length == 0 ? null : address;
        order.PaymentAmount = dto.Amount;
        order.IsUnpaid = true;
        order.DepositOnName = deposit.Length == 0 ? null : deposit;
        order.Notes = notes.Length == 0 ? null : notes;
        order.SystemType = ToSystemType(dto.Category);

        if (order.Shifts is { Count: > 0 })
        {
            var ordered = order.Shifts.OrderBy(s => s.OrderDate).ThenBy(s => s.TimeSlot).ToList();
            var oldStart = ordered[0].OrderDate;
            var deltaDays = chargeDate.DayNumber - oldStart.DayNumber;
            if (deltaDays != 0)
            {
                foreach (var shift in order.Shifts)
                {
                    shift.OrderDate = shift.OrderDate.AddDays(deltaDays);
                }
            }
        }

        await _orders.SaveChangesAsync(cancellationToken);

        await _customers.SyncFromWaitlistAsync(
            phone,
            customerName.Length == 0 ? null : customerName,
            address.Length == 0 ? null : address,
            order.SystemType,
            cancellationToken);

        var groups = await GetOpenDebtGroupsAsync(cancellationToken);
        var group = groups.FirstOrDefault(g => g.OrderIds.Contains(orderId))
            ?? new OpenDebtGroupDto
            {
                GroupKey = BuildSessionKey(phone, chargedAt, dto.Category),
                CustomerName = customerName,
                Phone = phone,
                Address = order.Address,
                Category = dto.Category,
                CategoryLabel = CategoryLabel(dto.Category),
                TotalAmount = dto.Amount,
                EquipmentSummary = BuildOrderEquipmentSummary(order),
                Deposit = FormatOrderDeposit(order),
                Notes = order.Notes,
                SessionDate = chargedAt.Date,
                DebtIds = [],
                OrderIds = [orderId]
            };

        return new CreatedOpenDebtDto
        {
            DebtId = 0,
            Group = group
        };
    }

    public async Task MarkGroupPaidAsync(
        MarkOpenDebtGroupPaidDto dto,
        CancellationToken cancellationToken = default)
    {
        var debtIds = (dto.DebtIds ?? []).Where(id => id > 0).Distinct().ToList();
        var orderIds = (dto.OrderIds ?? []).Where(id => id > 0).Distinct().ToList();

        if (debtIds.Count == 0 && orderIds.Count == 0)
        {
            throw new ValidationException("לא נבחרו חובות לסימון כשולמו");
        }

        if (debtIds.Count > 0)
        {
            var debts = await _db.CustomerDebts
                .Where(d => debtIds.Contains(d.Id))
                .ToListAsync(cancellationToken);
            foreach (var debt in debts)
            {
                debt.IsPaid = true;
            }

            await _db.SaveChangesAsync(cancellationToken);
        }

        foreach (var orderId in orderIds)
        {
            await _orderService.MarkOrderAsPaidAsync(orderId, cancellationToken);
        }
    }

    public async Task MarkDebtPaidAsync(int debtId, CancellationToken cancellationToken = default)
    {
        if (debtId <= 0)
        {
            throw new ValidationException("מזהה חוב לא תקין");
        }

        var debt = await _db.CustomerDebts
            .FirstOrDefaultAsync(d => d.Id == debtId, cancellationToken)
            ?? throw new NotFoundException("החוב לא נמצא");

        if (debt.IsPaid)
        {
            return;
        }

        debt.IsPaid = true;
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task DeleteGroupAsync(
        MarkOpenDebtGroupPaidDto dto,
        CancellationToken cancellationToken = default)
    {
        var debtIds = (dto.DebtIds ?? []).Where(id => id > 0).Distinct().ToList();
        var orderIds = (dto.OrderIds ?? []).Where(id => id > 0).Distinct().ToList();

        if (debtIds.Count == 0 && orderIds.Count == 0)
        {
            throw new ValidationException("לא נבחרו חובות למחיקה");
        }

        if (debtIds.Count > 0)
        {
            var debts = await _db.CustomerDebts
                .Where(d => debtIds.Contains(d.Id))
                .ToListAsync(cancellationToken);
            _db.CustomerDebts.RemoveRange(debts);
            await _db.SaveChangesAsync(cancellationToken);
        }

        foreach (var orderId in orderIds)
        {
            var order = await _orders.GetByIdAsync(orderId, cancellationToken)
                ?? throw new NotFoundException("ההזמנה לא נמצאה");

            // Remove the open-debt obligation without deleting the booking itself.
            order.PaymentAmount = null;
            order.IsUnpaid = false;
            await _orders.SaveChangesAsync(cancellationToken);
        }
    }

    public static string BuildSessionKey(string phone, DateTime chargedAtUtc, DebtCategory category)
    {
        var digits = new string((phone ?? string.Empty).Where(char.IsDigit).ToArray());
        var day = chargedAtUtc.ToUniversalTime().ToString("yyyy-MM-dd");
        return $"{digits}|{day}|{(int)category}";
    }

    private async Task<CreatedOpenDebtDto> BuildCreatedResultAsync(
        CustomerDebt debt,
        CancellationToken cancellationToken)
    {
        var groups = await GetOpenDebtGroupsAsync(cancellationToken);
        var group = groups.FirstOrDefault(g => g.DebtIds.Contains(debt.Id))
            ?? new OpenDebtGroupDto
            {
                GroupKey = debt.SessionKey,
                CustomerName = debt.CustomerName,
                Phone = debt.Phone,
                Address = debt.Address,
                Category = debt.Category,
                CategoryLabel = CategoryLabel(debt.Category),
                TotalAmount = debt.Amount,
                EquipmentSummary = debt.ItemDescription,
                Deposit = debt.Deposit,
                Notes = debt.Notes,
                SessionDate = debt.ChargedAt.Date,
                DebtIds = [debt.Id],
                OrderIds = []
            };

        return new CreatedOpenDebtDto
        {
            DebtId = debt.Id,
            Group = group
        };
    }

    private static OpenDebtDetailDto ToDetailDto(CustomerDebt debt) => new()
    {
        Id = debt.Id,
        CustomerName = debt.CustomerName,
        Phone = debt.Phone,
        Address = debt.Address,
        Category = debt.Category,
        CategoryLabel = CategoryLabel(debt.Category),
        ItemDescription = debt.ItemDescription,
        Deposit = debt.Deposit,
        Notes = debt.Notes,
        Amount = debt.Amount,
        ChargedAt = debt.ChargedAt,
        IsPaid = debt.IsPaid
    };

    /// <summary>
    /// Maps an optional local calendar day to a UTC midnight timestamp used for SessionKey grouping.
    /// </summary>
    private static DateTime ResolveChargeTimestamp(DateOnly? chargedAt)
    {
        if (chargedAt is { } day)
        {
            return DateTime.SpecifyKind(day.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);
        }

        return DateTime.UtcNow;
    }

    /// <summary>
    /// Billing / charge date for an unpaid order: earliest shift date (תחילת הזמנה / איסוף).
    /// Falls back to <see cref="Order.CreatedAt"/> only when the order has no shifts.
    /// </summary>
    private static DateTime ResolveOrderChargeDate(Order order)
    {
        if (order.Shifts is { Count: > 0 })
        {
            var start = order.Shifts.Min(s => s.OrderDate);
            return DateTime.SpecifyKind(start.ToDateTime(TimeOnly.MinValue), DateTimeKind.Utc);
        }

        return order.CreatedAt.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(order.CreatedAt, DateTimeKind.Utc)
            : order.CreatedAt.ToUniversalTime();
    }

    public static string CategoryLabel(DebtCategory category) => category switch
    {
        DebtCategory.Tools => "כלי עבודה",
        DebtCategory.Library => "ספריה",
        _ => "הגברה"
    };

    private static DebtCategory ToDebtCategory(SystemType systemType) => systemType switch
    {
        SystemType.Tools => DebtCategory.Tools,
        SystemType.Library => DebtCategory.Library,
        _ => DebtCategory.Amplification
    };

    private static SystemType ToSystemType(DebtCategory category) => category switch
    {
        DebtCategory.Tools => SystemType.Tools,
        DebtCategory.Library => SystemType.Library,
        _ => SystemType.Sound
    };

    /// <summary>
    /// Builds the open-debt "ציוד" label from primary equipment only:
    /// booking-slot units plus main loaned units (e.g. Mixer).
    /// Accessories (cables, bags, adaptors, auto-attached defaults, etc.) are excluded.
    /// </summary>
    private static string BuildOrderEquipmentSummary(Order order)
    {
        var parts = new List<string>();

        if (order.Equipments is { Count: > 0 })
        {
            foreach (var eq in order.Equipments
                .OrderBy(e => e.EquipmentDefinition?.SortOrder ?? int.MaxValue)
                .ThenBy(e => e.EquipmentDefinition?.DisplayName ?? e.EquipmentDefinitionId))
            {
                var displayName = eq.EquipmentDefinition?.DisplayName?.Trim();
                var name = !string.IsNullOrWhiteSpace(displayName)
                    ? displayName
                    : (eq.EquipmentDefinitionId ?? string.Empty).Trim();
                if (name.Length > 0)
                {
                    parts.Add(name);
                }
            }
        }

        if (order.LoanedEquipments is { Count: > 0 })
        {
            foreach (var loaned in order.LoanedEquipments)
            {
                if (!IsPrimaryLoanedEquipment(loaned))
                {
                    continue;
                }

                var name = loaned.LoanedEquipmentType is { } type
                    ? LoanedEquipmentTypeLabels.GetLabel(type)
                    : (loaned.CustomItemName ?? string.Empty).Trim();
                if (name.Length > 0)
                {
                    parts.Add(name);
                }
            }
        }

        return string.Join(", ", parts.Distinct(StringComparer.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Primary loaned units that should appear in debt summaries (not accessory kit items).
    /// </summary>
    private static bool IsPrimaryLoanedEquipment(OrderLoanedEquipment loaned)
    {
        if (loaned.IsCustomItem || loaned.LoanedEquipmentType is null)
        {
            return false;
        }

        return loaned.LoanedEquipmentType is LoanedEquipmentType.Mixer
            or LoanedEquipmentType.Microphone;
    }

    private static string? FormatOrderDeposit(Order order)
    {
        var typeLabel = order.DepositType switch
        {
            DepositType.Check => "צ׳ק",
            DepositType.CreditCard => "כרטיס אשראי",
            DepositType.Cash => "מזומן",
            _ => null
        };
        var onName = string.IsNullOrWhiteSpace(order.DepositOnName) ? null : order.DepositOnName.Trim();
        if (typeLabel is null && onName is null)
        {
            return null;
        }

        if (typeLabel is null)
        {
            return onName;
        }

        return onName is null ? typeLabel : $"{typeLabel} — {onName}";
    }
}
