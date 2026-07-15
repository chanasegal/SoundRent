using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Application.Services;

public interface IOpenDebtService
{
    Task<List<OpenDebtGroupDto>> GetOpenDebtGroupsAsync(CancellationToken cancellationToken = default);
    Task MarkGroupPaidAsync(MarkOpenDebtGroupPaidDto dto, CancellationToken cancellationToken = default);
    Task MarkDebtPaidAsync(int debtId, CancellationToken cancellationToken = default);
}

public class OpenDebtService : IOpenDebtService
{
    private readonly AppDbContext _db;
    private readonly IOrderRepository _orders;
    private readonly IOrderService _orderService;

    public OpenDebtService(AppDbContext db, IOrderRepository orders, IOrderService orderService)
    {
        _db = db;
        _orders = orders;
        _orderService = orderService;
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
                    SessionDate = g.Max(x => x.SessionDate),
                    DebtIds = g.Where(x => x.DebtId.HasValue).Select(x => x.DebtId!.Value).Distinct().ToList(),
                    OrderIds = g.Where(x => x.OrderId.HasValue).Select(x => x.OrderId!.Value).Distinct().ToList()
                };
            })
            .OrderByDescending(g => g.SessionDate)
            .ThenBy(g => g.CustomerName)
            .ToList();
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
}
