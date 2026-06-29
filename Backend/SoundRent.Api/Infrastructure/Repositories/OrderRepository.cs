using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.PhoneNumbers;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Infrastructure.Repositories;

public class OrderRepository : IOrderRepository
{
    private readonly AppDbContext _db;

    public OrderRepository(AppDbContext db)
    {
        _db = db;
    }

    public Task<Order?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        return WithOrderGraph(_db.Orders)
            .AsSplitQuery()
            .FirstOrDefaultAsync(o => o.Id == id, cancellationToken);
    }

    public Task<List<Order>> GetByDateRangeAsync(DateOnly startDate, DateOnly endDate, CancellationToken cancellationToken = default)
    {
        return WithOrderGraph(_db.Orders)
            .AsSplitQuery()
            .Where(o => !o.IsCancelled && o.Shifts.Any(s => s.OrderDate >= startDate && s.OrderDate <= endDate))
            .OrderBy(o => o.Shifts.Min(s => s.OrderDate))
            .ThenBy(o => o.Id)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public Task<List<Order>> GetAllForExportAsync(CancellationToken cancellationToken = default)
    {
        return WithOrderGraph(_db.Orders)
            .AsSplitQuery()
            .OrderBy(o => o.Shifts.Min(s => s.OrderDate))
            .ThenBy(o => o.Id)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public Task<bool> ExistsForSlotAsync(
        string equipmentType,
        DateOnly orderDate,
        TimeSlot timeSlot,
        int? excludeOrderId = null,
        CancellationToken cancellationToken = default)
    {
        var trimmed = equipmentType.Trim();
        var query = _db.Orders.AsNoTracking().Where(o =>
            !o.IsCancelled &&
            o.Equipments.Any(e => e.EquipmentDefinitionId == trimmed) &&
            o.Shifts.Any(s => s.OrderDate == orderDate && s.TimeSlot == timeSlot));

        if (excludeOrderId.HasValue)
        {
            query = query.Where(o => o.Id != excludeOrderId.Value);
        }

        return query.AnyAsync(cancellationToken);
    }

    public async Task<OrderSlotConflictDto?> FindSlotConflictAsync(
        IReadOnlyCollection<string> equipmentDefinitionIds,
        IReadOnlyCollection<OrderShiftDto> shifts,
        int? excludeOrderId = null,
        CancellationToken cancellationToken = default)
    {
        if (equipmentDefinitionIds.Count == 0 || shifts.Count == 0)
        {
            return null;
        }

        var equipmentSet = equipmentDefinitionIds
            .Select(e => e.Trim())
            .Where(e => e.Length > 0)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var dates = shifts.Select(s => s.OrderDate).Distinct().ToList();
        var timeSlots = shifts.Select(s => s.TimeSlot).Distinct().ToList();
        var shiftSet = shifts
            .Select(s => (s.OrderDate, s.TimeSlot))
            .ToHashSet();

        var query = WithOrderGraph(_db.Orders)
            .AsSplitQuery()
            .AsNoTracking()
            .Where(o =>
                !o.IsCancelled &&
                o.Equipments.Any(e => equipmentSet.Contains(e.EquipmentDefinitionId)) &&
                o.Shifts.Any(s => dates.Contains(s.OrderDate) && timeSlots.Contains(s.TimeSlot)));

        if (excludeOrderId.HasValue)
        {
            query = query.Where(o => o.Id != excludeOrderId.Value);
        }

        var candidates = await query.ToListAsync(cancellationToken);
        foreach (var order in candidates)
        {
            var equipment = order.Equipments
                .OrderBy(e => e.EquipmentDefinition?.SortOrder ?? int.MaxValue)
                .ThenBy(e => e.EquipmentDefinitionId)
                .FirstOrDefault(e => equipmentSet.Contains(e.EquipmentDefinitionId));
            var shift = order.Shifts
                .OrderBy(s => s.OrderDate)
                .ThenBy(s => s.TimeSlot)
                .FirstOrDefault(s => shiftSet.Contains((s.OrderDate, s.TimeSlot)));

            if (equipment is null || shift is null)
            {
                continue;
            }

            return new OrderSlotConflictDto
            {
                OrderId = order.Id,
                EquipmentDefinitionId = equipment.EquipmentDefinitionId,
                EquipmentDisplayName = equipment.EquipmentDefinition?.DisplayName,
                OrderDate = shift.OrderDate,
                TimeSlot = shift.TimeSlot
            };
        }

        return null;
    }

    public async Task<IReadOnlyList<EquipmentDefinitionDeleteFutureOrderDto>> GetFutureOrdersForEquipmentTypeAsync(
        string equipmentType,
        DateOnly todayInclusive,
        CancellationToken cancellationToken = default)
    {
        var trimmed = equipmentType.Trim();
        return await _db.Orders
            .AsNoTracking()
            .Where(o =>
                !o.IsCancelled &&
                o.Equipments.Any(e => e.EquipmentDefinitionId == trimmed) &&
                o.Shifts.Any(s => s.OrderDate >= todayInclusive))
            .OrderBy(o => o.Shifts.Where(s => s.OrderDate >= todayInclusive).Min(s => s.OrderDate))
            .ThenBy(o => o.Id)
            .Select(o => new EquipmentDefinitionDeleteFutureOrderDto
            {
                OrderId = o.Id,
                CustomerName = o.CustomerName,
                OrderDate = o.Shifts.Where(s => s.OrderDate >= todayInclusive).Min(s => s.OrderDate)
            })
            .ToListAsync(cancellationToken);
    }

    public Task<int> DeleteOrdersForEquipmentTypeBeforeDateAsync(
        string equipmentType,
        DateOnly beforeExclusive,
        CancellationToken cancellationToken = default)
    {
        var trimmed = equipmentType.Trim();
        return _db.Orders
            .Where(o =>
                o.Equipments.Any(e => e.EquipmentDefinitionId == trimmed) &&
                o.Shifts.All(s => s.OrderDate < beforeExclusive))
            .ExecuteDeleteAsync(cancellationToken);
    }

    public async Task AddAsync(Order order, CancellationToken cancellationToken = default)
    {
        await _db.Orders.AddAsync(order, cancellationToken);
    }

    public void Remove(Order order)
    {
        _db.Orders.Remove(order);
    }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return _db.SaveChangesAsync(cancellationToken);
    }

    public async Task<List<Order>> GetOrdersForCustomerPhonesAsync(
        IReadOnlyCollection<string> normalizedDigitPhones,
        CancellationToken cancellationToken = default)
    {
        if (normalizedDigitPhones.Count == 0)
        {
            return new List<Order>();
        }

        var set = new HashSet<string>(normalizedDigitPhones.Where(p => p.Length > 0));
        var orders = await _db.Orders
            .AsNoTracking()
            .Include(o => o.Equipments)
            .ThenInclude(e => e.EquipmentDefinition)
            .Include(o => o.Shifts)
            .Include(o => o.LoanedEquipments)
            .ThenInclude(le => le.Notes)
            .AsSplitQuery()
            .OrderByDescending(o => o.Shifts.Max(s => s.OrderDate))
            .ThenByDescending(o => o.Id)
            .ToListAsync(cancellationToken);

        return orders
            .Where(o =>
            {
                var p = PhoneNumberNormalizer.DigitsOnly(o.Phone);
                var p2 = PhoneNumberNormalizer.DigitsOnly(o.Phone2);
                return set.Contains(p) || (!string.IsNullOrEmpty(p2) && set.Contains(p2));
            })
            .ToList();
    }

    public async Task<bool> HasActiveOrFutureOrdersForCustomerPhonesAsync(
        IReadOnlyCollection<string> normalizedDigitPhones,
        DateOnly todayInclusive,
        CancellationToken cancellationToken = default)
    {
        var set = normalizedDigitPhones
            .Where(p => p.Length > 0)
            .ToHashSet();
        if (set.Count == 0)
        {
            return false;
        }

        var orders = await _db.Orders
            .AsNoTracking()
            .Where(o => !o.IsCancelled && o.Shifts.Any(s => s.OrderDate >= todayInclusive))
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        return orders.Any(o =>
        {
            var p = PhoneNumberNormalizer.DigitsOnly(o.Phone);
            var p2 = PhoneNumberNormalizer.DigitsOnly(o.Phone2);
            return set.Contains(p) || (!string.IsNullOrEmpty(p2) && set.Contains(p2));
        });
    }

    public Task<List<Order>> GetCancelledOrdersAsync(CancellationToken cancellationToken = default)
    {
        return WithOrderGraph(_db.Orders)
            .AsSplitQuery()
            .Where(o => o.IsCancelled)
            .OrderByDescending(o => o.Shifts.Max(s => s.OrderDate))
            .ThenByDescending(o => o.Id)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public Task<List<Order>> GetUnpaidOrdersAsync(CancellationToken cancellationToken = default)
    {
        return WithOrderGraph(_db.Orders)
            .AsSplitQuery()
            .Where(o => !o.IsPaid)
            .OrderByDescending(o => o.Shifts.Max(s => s.OrderDate))
            .ThenByDescending(o => o.Id)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    private static IQueryable<Order> WithOrderGraph(IQueryable<Order> query)
    {
        return query
            .Include(o => o.Equipments)
            .ThenInclude(e => e.EquipmentDefinition)
            .Include(o => o.Shifts)
            .Include(o => o.LoanedEquipments)
            .ThenInclude(le => le.Notes);
    }
}
