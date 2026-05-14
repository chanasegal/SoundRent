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
        return _db.Orders
            .Include(o => o.LoanedEquipments)
            .ThenInclude(le => le.Notes)
            .AsSplitQuery()
            .FirstOrDefaultAsync(o => o.Id == id, cancellationToken);
    }

    public Task<List<Order>> GetByDateRangeAsync(DateOnly startDate, DateOnly endDate, CancellationToken cancellationToken = default)
    {
        return _db.Orders
            .Include(o => o.LoanedEquipments)
            .ThenInclude(le => le.Notes)
            .AsSplitQuery()
            .Where(o => o.OrderDate >= startDate && o.OrderDate <= endDate)
            .OrderBy(o => o.OrderDate)
            .ThenBy(o => o.TimeSlot)
            .ThenBy(o => o.EquipmentType)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public Task<List<Order>> GetAllForExportAsync(CancellationToken cancellationToken = default)
    {
        return _db.Orders
            .Include(o => o.LoanedEquipments)
            .ThenInclude(le => le.Notes)
            .AsSplitQuery()
            .OrderBy(o => o.OrderDate)
            .ThenBy(o => o.TimeSlot)
            .ThenBy(o => o.EquipmentType)
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
        var query = _db.Orders.AsNoTracking().Where(o =>
            o.EquipmentType == equipmentType &&
            o.OrderDate == orderDate &&
            o.TimeSlot == timeSlot);

        if (excludeOrderId.HasValue)
        {
            query = query.Where(o => o.Id != excludeOrderId.Value);
        }

        return query.AnyAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<EquipmentDefinitionDeleteFutureOrderDto>> GetFutureOrdersForEquipmentTypeAsync(
        string equipmentType,
        DateOnly todayInclusive,
        CancellationToken cancellationToken = default)
    {
        var trimmed = equipmentType.Trim();
        return await _db.Orders
            .AsNoTracking()
            .Where(o => o.EquipmentType == trimmed && o.OrderDate >= todayInclusive)
            .OrderBy(o => o.OrderDate)
            .ThenBy(o => o.Id)
            .Select(o => new EquipmentDefinitionDeleteFutureOrderDto
            {
                OrderId = o.Id,
                CustomerName = o.CustomerName,
                OrderDate = o.OrderDate
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
            .Where(o => o.EquipmentType == trimmed && o.OrderDate < beforeExclusive)
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
            .Include(o => o.LoanedEquipments)
            .ThenInclude(le => le.Notes)
            .AsSplitQuery()
            .OrderByDescending(o => o.OrderDate)
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
}
