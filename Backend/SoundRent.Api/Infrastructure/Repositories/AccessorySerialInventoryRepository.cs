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

    public async Task<Dictionary<LoanedEquipmentType, List<string>>> GetSerialCodesGroupedAsync(
        IReadOnlyCollection<LoanedEquipmentType>? typesFilter = null,
        CancellationToken cancellationToken = default)
    {
        var query = _db.AccessorySerialInventory.AsNoTracking();
        if (typesFilter is { Count: > 0 })
        {
            var typeList = typesFilter.Distinct().ToList();
            query = query.Where(r => typeList.Contains(r.EquipmentType));
        }

        var rows = await query
            .OrderBy(r => r.EquipmentType)
            .ThenBy(r => r.SerialCode)
            .Select(r => new { r.EquipmentType, r.SerialCode })
            .ToListAsync(cancellationToken);

        var result = new Dictionary<LoanedEquipmentType, List<string>>();
        foreach (var row in rows)
        {
            if (!result.TryGetValue(row.EquipmentType, out var codes))
            {
                codes = [];
                result[row.EquipmentType] = codes;
            }

            codes.Add(row.SerialCode);
        }

        return result;
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

        var statusByKey = existing.ToDictionary(
            r => (r.EquipmentType, Code: r.SerialCode),
            r => r.PhysicalStatus,
            new EquipmentTypeCodeComparer());

        if (existing.Count > 0)
        {
            _db.AccessorySerialInventory.RemoveRange(existing);
        }

        var toAdd = new List<AccessorySerialInventory>();
        foreach (var (equipmentType, serialCodes) in updatesByType)
        {
            foreach (var code in serialCodes)
            {
                var key = (equipmentType, Code: code);
                toAdd.Add(new AccessorySerialInventory
                {
                    EquipmentType = equipmentType,
                    SerialCode = code,
                    PhysicalStatus = statusByKey.TryGetValue(key, out var status)
                        ? status
                        : AccessorySerialPhysicalStatus.InWarehouse
                });
            }
        }

        if (toAdd.Count > 0)
        {
            _db.AccessorySerialInventory.AddRange(toAdd);
        }
    }

    public async Task<Dictionary<LoanedEquipmentType, HashSet<string>>> GetLoanedOutCodesGroupedAsync(
        IReadOnlyCollection<LoanedEquipmentType>? typesFilter = null,
        CancellationToken cancellationToken = default)
    {
        var query = _db.AccessorySerialInventory.AsNoTracking()
            .Where(r => r.PhysicalStatus == AccessorySerialPhysicalStatus.LoanedOut);

        if (typesFilter is { Count: > 0 })
        {
            var typeList = typesFilter.Distinct().ToList();
            query = query.Where(r => typeList.Contains(r.EquipmentType));
        }

        var rows = await query
            .Select(r => new { r.EquipmentType, r.SerialCode })
            .ToListAsync(cancellationToken);

        return GroupCodesByType(rows.Select(r => (r.EquipmentType, r.SerialCode)));
    }

    public async Task<Dictionary<LoanedEquipmentType, HashSet<string>>> GetAssignedCodesForOrderAsync(
        int orderId,
        IReadOnlyCollection<LoanedEquipmentType>? typesFilter = null,
        CancellationToken cancellationToken = default)
    {
        var lines = _db.OrderLoanedEquipments.AsNoTracking()
            .Where(le => le.OrderId == orderId
                         && !le.IsCustomItem
                         && le.LoanedEquipmentType != null);

        if (typesFilter is { Count: > 0 })
        {
            var typeList = typesFilter.Distinct().ToList();
            lines = lines.Where(le => typeList.Contains(le.LoanedEquipmentType!.Value));
        }

        var pairs = await (
            from le in lines
            join note in _db.LoanedEquipmentNotes.AsNoTracking()
                on le.Id equals note.OrderLoanedEquipmentId
            where note.Content != null && note.Content != "" && !note.IsReturned
            select new
            {
                Type = le.LoanedEquipmentType!.Value,
                Code = note.Content!
            }).ToListAsync(cancellationToken);

        return GroupCodesByType(pairs.Select(p => (p.Type, p.Code)));
    }

    public async Task<Dictionary<(LoanedEquipmentType Type, string Code), int>> GetActiveSerialOwnersAsync(
        int? excludeOrderId = null,
        CancellationToken cancellationToken = default)
    {
        var query =
            from le in _db.OrderLoanedEquipments.AsNoTracking()
            join order in _db.Orders.AsNoTracking() on le.OrderId equals order.Id
            join note in _db.LoanedEquipmentNotes.AsNoTracking() on le.Id equals note.OrderLoanedEquipmentId
            where !order.IsCancelled
                  && !le.IsCustomItem
                  && le.LoanedEquipmentType != null
                  && note.Content != null
                  && note.Content != ""
                  && !note.IsReturned
            select new
            {
                Type = le.LoanedEquipmentType!.Value,
                Code = note.Content!,
                le.OrderId
            };

        if (excludeOrderId is int excludedOrderId)
        {
            query = query.Where(row => row.OrderId != excludedOrderId);
        }

        var rows = await query.ToListAsync(cancellationToken);
        var result = new Dictionary<(LoanedEquipmentType Type, string Code), int>(
            new EquipmentTypeCodeComparer());

        foreach (var row in rows)
        {
            var code = row.Code.Trim();
            if (code.Length == 0)
            {
                continue;
            }

            result[(row.Type, code)] = row.OrderId;
        }

        return result;
    }

    public async Task<AccessorySerialLocationQueryResult?> GetSerialCodeLocationAsync(
        LoanedEquipmentType equipmentType,
        string serialCode,
        CancellationToken cancellationToken = default)
    {
        var code = serialCode.Trim();
        if (code.Length == 0)
        {
            return null;
        }

        var candidates = await _db.AccessorySerialInventory
            .AsNoTracking()
            .Where(r => r.EquipmentType == equipmentType)
            .ToListAsync(cancellationToken);

        var inventory = candidates.FirstOrDefault(r =>
            string.Equals(r.SerialCode, code, StringComparison.OrdinalIgnoreCase));

        if (inventory is null)
        {
            return null;
        }

        if (inventory.PhysicalStatus == AccessorySerialPhysicalStatus.InWarehouse)
        {
            return new AccessorySerialLocationQueryResult
            {
                EquipmentType = equipmentType,
                SerialCode = inventory.SerialCode,
                PhysicalStatus = inventory.PhysicalStatus
            };
        }

        var activeAssignment = await (
            from le in _db.OrderLoanedEquipments.AsNoTracking()
            join order in _db.Orders.AsNoTracking() on le.OrderId equals order.Id
            join note in _db.LoanedEquipmentNotes.AsNoTracking() on le.Id equals note.OrderLoanedEquipmentId
            where !order.IsCancelled
                  && !le.IsCustomItem
                  && le.LoanedEquipmentType == equipmentType
                  && note.Content != null
                  && note.Content != ""
                  && !note.IsReturned
            select new
            {
                Code = note.Content!,
                order.Id,
                order.CustomerName,
                order.Phone,
                order.Phone2,
                order.Address,
                order.DepositType,
                order.DepositOnName,
                order.Notes
            }).ToListAsync(cancellationToken);

        var match = activeAssignment.FirstOrDefault(row =>
            string.Equals(row.Code.Trim(), code, StringComparison.OrdinalIgnoreCase));

        return new AccessorySerialLocationQueryResult
        {
            EquipmentType = equipmentType,
            SerialCode = inventory.SerialCode,
            PhysicalStatus = inventory.PhysicalStatus,
            ActiveOrderId = match?.Id,
            CustomerName = match?.CustomerName,
            Phone = match?.Phone,
            Phone2 = match?.Phone2,
            Address = match?.Address,
            Deposit = FormatDeposit(match?.DepositType, match?.DepositOnName),
            Notes = match?.Notes
        };
    }

    private static string? FormatDeposit(DepositType? depositType, string? depositOnName)
    {
        var typeLabel = depositType switch
        {
            DepositType.Check => "צ׳ק",
            DepositType.CreditCard => "כרטיס אשראי",
            DepositType.Cash => "מזומן",
            _ => null
        };
        var onName = string.IsNullOrWhiteSpace(depositOnName) ? null : depositOnName.Trim();

        if (typeLabel is null && onName is null)
        {
            return null;
        }

        if (typeLabel is null)
        {
            return onName;
        }

        if (onName is null)
        {
            return typeLabel;
        }

        return $"{typeLabel} — {onName}";
    }

    public async Task SetPhysicalStatusAsync(
        LoanedEquipmentType equipmentType,
        string serialCode,
        AccessorySerialPhysicalStatus status,
        CancellationToken cancellationToken = default)
    {
        var code = serialCode.Trim();
        if (code.Length == 0)
        {
            return;
        }

        var candidates = await _db.AccessorySerialInventory
            .Where(r => r.EquipmentType == equipmentType)
            .ToListAsync(cancellationToken);

        var row = candidates.FirstOrDefault(r =>
            string.Equals(r.SerialCode, code, StringComparison.OrdinalIgnoreCase));

        if (row is null)
        {
            return;
        }

        row.PhysicalStatus = status;
    }

    public async Task<Dictionary<LoanedEquipmentType, HashSet<string>>> GetBookedSerialCodesByTypesAsync(
        IReadOnlyCollection<DateOnly> dates,
        IReadOnlyCollection<OrderShiftDto>? shiftsFilter,
        IReadOnlyCollection<LoanedEquipmentType>? typesFilter,
        int? excludeOrderId,
        CancellationToken cancellationToken = default)
    {
        if (dates.Count == 0 && (shiftsFilter is null || shiftsFilter.Count == 0))
        {
            return new Dictionary<LoanedEquipmentType, HashSet<string>>();
        }

        IQueryable<int> matchingOrderIds;
        if (shiftsFilter is { Count: > 0 })
        {
            var (morningDates, eveningDates) = ExtractShiftDateBuckets(shiftsFilter);
            if (morningDates.Count == 0 && eveningDates.Count == 0)
            {
                return new Dictionary<LoanedEquipmentType, HashSet<string>>();
            }

            matchingOrderIds =
                from shift in _db.OrderShifts.AsNoTracking()
                join order in _db.Orders.AsNoTracking() on shift.OrderId equals order.Id
                where !order.IsCancelled
                      && ((morningDates.Contains(shift.OrderDate) && shift.TimeSlot == TimeSlot.Morning)
                          || (eveningDates.Contains(shift.OrderDate) && shift.TimeSlot == TimeSlot.Evening))
                select shift.OrderId;
        }
        else
        {
            var dateList = dates.ToList();
            matchingOrderIds =
                from shift in _db.OrderShifts.AsNoTracking()
                join order in _db.Orders.AsNoTracking() on shift.OrderId equals order.Id
                where !order.IsCancelled && dateList.Contains(shift.OrderDate)
                select shift.OrderId;
        }

        if (excludeOrderId is int excludedOrderId)
        {
            matchingOrderIds = matchingOrderIds.Where(id => id != excludedOrderId);
        }

        var lines = _db.OrderLoanedEquipments.AsNoTracking()
            .Where(le => matchingOrderIds.Contains(le.OrderId)
                         && !le.IsCustomItem
                         && le.LoanedEquipmentType != null);

        if (typesFilter is { Count: > 0 })
        {
            var typeList = typesFilter.Distinct().ToList();
            lines = lines.Where(le => typeList.Contains(le.LoanedEquipmentType!.Value));
        }

        var pairs = await (
            from le in lines
            join note in _db.LoanedEquipmentNotes.AsNoTracking()
                on le.Id equals note.OrderLoanedEquipmentId
            where note.Content != null && note.Content != "" && !note.IsReturned
            select new
            {
                Type = le.LoanedEquipmentType!.Value,
                Code = note.Content!
            }).ToListAsync(cancellationToken);

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
        var byType = await GetBookedSerialCodesByTypesAsync(
            dates,
            shiftsFilter,
            [equipmentType],
            excludeOrderId,
            cancellationToken);
        return byType.TryGetValue(equipmentType, out var codes)
            ? codes
            : new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) =>
        _db.SaveChangesAsync(cancellationToken);

    private static Dictionary<LoanedEquipmentType, HashSet<string>> GroupCodesByType(
        IEnumerable<(LoanedEquipmentType Type, string Code)> pairs)
    {
        var result = new Dictionary<LoanedEquipmentType, HashSet<string>>();
        foreach (var (type, rawCode) in pairs)
        {
            var code = rawCode.Trim();
            if (code.Length == 0)
            {
                continue;
            }

            if (!result.TryGetValue(type, out var bucket))
            {
                bucket = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                result[type] = bucket;
            }

            bucket.Add(code);
        }

        return result;
    }

    private sealed class EquipmentTypeCodeComparer : IEqualityComparer<(LoanedEquipmentType EquipmentType, string Code)>
    {
        public bool Equals((LoanedEquipmentType EquipmentType, string Code) x, (LoanedEquipmentType EquipmentType, string Code) y) =>
            x.EquipmentType == y.EquipmentType
            && string.Equals(x.Code, y.Code, StringComparison.OrdinalIgnoreCase);

        public int GetHashCode((LoanedEquipmentType EquipmentType, string Code) obj) =>
            HashCode.Combine((int)obj.EquipmentType, StringComparer.OrdinalIgnoreCase.GetHashCode(obj.Code));
    }

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
