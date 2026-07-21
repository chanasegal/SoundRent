using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Validation;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Application.Services;

public interface IOpenDebtService
{
    Task<List<OpenDebtGroupDto>> GetOpenDebtGroupsAsync(CancellationToken cancellationToken = default);
    Task<CreatedOpenDebtDto> CreateDebtAsync(CreateOpenDebtDto dto, CancellationToken cancellationToken = default);
    Task MarkGroupPaidAsync(MarkOpenDebtGroupPaidDto dto, CancellationToken cancellationToken = default);
    Task MarkDebtPaidAsync(int debtId, CancellationToken cancellationToken = default);
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
            DebtCategory Category,
            decimal Amount,
            string ItemDescription,
            string? Deposit,
            DateTime SessionDate,
            int? DebtId,
            int? OrderId)>();

        var debts = await _db.CustomerDebts
            .AsNoTracking()
            .Where(d => !d.IsPaid)
            .ToListAsync(cancellationToken);

        foreach (var d in debts)
        {
            lines.Add((
                string.IsNullOrWhiteSpace(d.SessionKey)
                    ? BuildSessionKey(d.Phone, d.ChargedAt, d.Category)
                    : d.SessionKey,
                d.CustomerName,
                d.Phone,
                d.Category,
                d.Amount,
                d.ItemDescription,
                d.Deposit,
                d.ChargedAt.Date,
                d.Id,
                null));
        }

        var unpaidOrders = await _orders.GetUnpaidOrdersAsync(cancellationToken);
        foreach (var order in unpaidOrders.Where(o => !o.IsCancelled))
        {
            var category = ToDebtCategory(order.SystemType);
            var groupKey = BuildSessionKey(order.Phone, order.CreatedAt, category);
            lines.Add((
                groupKey,
                order.CustomerName ?? string.Empty,
                order.Phone,
                category,
                order.PaymentAmount ?? 0m,
                BuildOrderEquipmentSummary(order),
                FormatOrderDeposit(order),
                order.CreatedAt.Date,
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
                return new OpenDebtGroupDto
                {
                    GroupKey = g.Key,
                    CustomerName = g.Select(x => x.CustomerName).FirstOrDefault(n => !string.IsNullOrWhiteSpace(n))
                        ?? first.CustomerName,
                    Phone = first.Phone,
                    Category = first.Category,
                    CategoryLabel = CategoryLabel(first.Category),
                    TotalAmount = g.Sum(x => x.Amount),
                    EquipmentSummary = string.Join(", ", names),
                    Deposit = deposits.Count == 0 ? null : string.Join(", ", deposits),
                    SessionDate = g.Max(x => x.SessionDate),
                    DebtIds = g.Where(x => x.DebtId.HasValue).Select(x => x.DebtId!.Value).Distinct().ToList(),
                    OrderIds = g.Where(x => x.OrderId.HasValue).Select(x => x.OrderId!.Value).Distinct().ToList()
                };
            })
            .OrderByDescending(g => g.SessionDate)
            .ThenBy(g => g.CustomerName)
            .ToList();
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

        if (dto.Amount <= 0)
        {
            throw new ValidationException("סכום החוב חייב להיות גדול מאפס");
        }

        if (!Enum.IsDefined(typeof(DebtCategory), dto.Category))
        {
            throw new ValidationException("קטגוריית חוב לא תקינה");
        }

        var chargedAt = DateTime.UtcNow;
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

        var groups = await GetOpenDebtGroupsAsync(cancellationToken);
        var group = groups.FirstOrDefault(g => g.DebtIds.Contains(debt.Id))
            ?? new OpenDebtGroupDto
            {
                GroupKey = debt.SessionKey,
                CustomerName = debt.CustomerName,
                Phone = debt.Phone,
                Category = debt.Category,
                CategoryLabel = CategoryLabel(debt.Category),
                TotalAmount = debt.Amount,
                EquipmentSummary = debt.ItemDescription,
                Deposit = debt.Deposit,
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

    public static string BuildSessionKey(string phone, DateTime chargedAtUtc, DebtCategory category)
    {
        var digits = new string((phone ?? string.Empty).Where(char.IsDigit).ToArray());
        var day = chargedAtUtc.ToUniversalTime().ToString("yyyy-MM-dd");
        return $"{digits}|{day}|{(int)category}";
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

    private static string BuildOrderEquipmentSummary(Order order)
    {
        var parts = new List<string>();
        if (order.Equipments != null)
        {
            foreach (var eq in order.Equipments)
            {
                if (!string.IsNullOrWhiteSpace(eq.EquipmentDefinitionId))
                {
                    parts.Add(eq.EquipmentDefinitionId.Trim());
                }
            }
        }

        if (order.LoanedEquipments != null)
        {
            foreach (var loaned in order.LoanedEquipments)
            {
                var name = !string.IsNullOrWhiteSpace(loaned.CustomItemName)
                    ? loaned.CustomItemName.Trim()
                    : loaned.LoanedEquipmentType?.ToString() ?? string.Empty;
                if (!string.IsNullOrWhiteSpace(name))
                {
                    parts.Add(name);
                }
            }
        }

        return string.Join(", ", parts.Distinct(StringComparer.OrdinalIgnoreCase));
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
