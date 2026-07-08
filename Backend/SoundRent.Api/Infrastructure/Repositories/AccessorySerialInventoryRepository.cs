using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Infrastructure.Repositories;

public class AccessorySerialInventoryRepository : IAccessorySerialInventoryRepository
{
    private readonly AppDbContext _db;

    public AccessorySerialInventoryRepository(AppDbContext db)
    {
        _db = db;
    }

    public Task<List<AccessorySerialInventory>> GetAllOrderedAsync(CancellationToken cancellationToken = default)
    {
        return _db.AccessorySerialInventory
            .AsNoTracking()
            .OrderBy(r => r.EquipmentType)
            .ThenBy(r => r.SerialCode)
            .ToListAsync(cancellationToken);
    }

    public async Task ReplaceCodesForTypeAsync(
        LoanedEquipmentType equipmentType,
        IReadOnlyCollection<string> serialCodes,
        CancellationToken cancellationToken = default)
    {
        await ReplaceAllTypesAsync(
            new Dictionary<LoanedEquipmentType, IReadOnlyCollection<string>>
            {
                [equipmentType] = serialCodes.ToList()
            },
            cancellationToken);
    }

    public async Task ReplaceAllTypesAsync(
        IReadOnlyDictionary<LoanedEquipmentType, IReadOnlyCollection<string>> updatesByType,
        CancellationToken cancellationToken = default)
    {
        if (updatesByType.Count == 0)
        {
            return;
        }

        var types = updatesByType.Keys.ToList();
        var existing = await _db.AccessorySerialInventory
            .Where(r => types.Contains(r.EquipmentType))
            .ToListAsync(cancellationToken);

        if (existing.Count > 0)
        {
            _db.AccessorySerialInventory.RemoveRange(existing);
        }

        foreach (var (equipmentType, serialCodes) in updatesByType)
        {
            foreach (var code in serialCodes)
            {
                _db.AccessorySerialInventory.Add(new AccessorySerialInventory
                {
                    EquipmentType = equipmentType,
                    SerialCode = code
                });
            }
        }
    }

    public async Task<Dictionary<LoanedEquipmentType, HashSet<string>>> GetBookedSerialCodesByTypesAsync(
        IReadOnlyCollection<DateOnly> dates,
        IReadOnlyCollection<OrderShiftDto>? shiftsFilter,
        int? excludeOrderId,
        CancellationToken cancellationToken = default)
    {
        if (dates.Count == 0 && (shiftsFilter is null || shiftsFilter.Count == 0))
        {
            return new Dictionary<LoanedEquipmentType, HashSet<string>>();
        }

        var orders = _db.Orders
            .AsNoTracking()
            .Where(o => !o.IsCancelled);

        if (shiftsFilter is { Count: > 0 })
        {
            var (morningDates, eveningDates) = ExtractShiftDateBuckets(shiftsFilter);
            if (morningDates.Count == 0 && eveningDates.Count == 0)
            {
                return new Dictionary<LoanedEquipmentType, HashSet<string>>();
            }

            // Compare only primitives (DateOnly + enum) so EF can translate to SQL.
            orders = orders.Where(o => o.Shifts.Any(s =>
                (morningDates.Contains(s.OrderDate) && s.TimeSlot == TimeSlot.Morning)
                || (eveningDates.Contains(s.OrderDate) && s.TimeSlot == TimeSlot.Evening)));
        }
        else
        {
            var dateList = dates.ToList();
            orders = orders.Where(o => o.Shifts.Any(s => dateList.Contains(s.OrderDate)));
        }

        if (excludeOrderId is int excludedOrderId)
        {
            orders = orders.Where(o => o.Id != excludedOrderId);
        }

        // Single SQL statement — avoids split-query fan-out that holds multiple pool connections.
        var pairs = await orders
            .AsSingleQuery()
            .SelectMany(o => o.LoanedEquipments
                .Where(le => !le.IsCustomItem && le.LoanedEquipmentType != null)
                .SelectMany(le => le.Notes
                    .Where(n => n.Content != null && n.Content != "")
                    .Select(n => new
                    {
                        Type = le.LoanedEquipmentType!.Value,
                        Code = n.Content!
                    })))
            .ToListAsync(cancellationToken);

        var result = new Dictionary<LoanedEquipmentType, HashSet<string>>();
        foreach (var pair in pairs)
        {
            var code = pair.Code.Trim();
            if (code.Length == 0)
            {
                continue;
            }

            if (!result.TryGetValue(pair.Type, out var bucket))
            {
                bucket = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                result[pair.Type] = bucket;
            }

            bucket.Add(code);
        }

        return result;
    }

    public async Task<HashSet<string>> GetBookedSerialCodesAsync(
        LoanedEquipmentType equipmentType,
        IReadOnlyCollection<DateOnly> dates,
        IReadOnlyCollection<OrderShiftDto>? shiftsFilter,
        int? excludeOrderId,
        CancellationToken cancellationToken = default)
    {
        var byType = await GetBookedSerialCodesByTypesAsync(dates, shiftsFilter, excludeOrderId, cancellationToken);
        return byType.TryGetValue(equipmentType, out var codes)
            ? codes
            : new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) =>
        _db.SaveChangesAsync(cancellationToken);

    /// <summary>
    /// Buckets shift filters into date lists per time slot so EF can translate Contains + enum checks.
    /// </summary>
    private static (List<DateOnly> MorningDates, List<DateOnly> EveningDates) ExtractShiftDateBuckets(
        IReadOnlyCollection<OrderShiftDto> shiftsFilter)
    {
        var morningDates = new HashSet<DateOnly>();
        var eveningDates = new HashSet<DateOnly>();

        foreach (var shift in shiftsFilter)
        {
            if (shift.TimeSlot == TimeSlot.Morning)
            {
                morningDates.Add(shift.OrderDate);
            }
            else if (shift.TimeSlot == TimeSlot.Evening)
            {
                eveningDates.Add(shift.OrderDate);
            }
        }

        return (morningDates.ToList(), eveningDates.ToList());
    }
}
