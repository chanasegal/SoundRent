using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Mapping;
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
            .AsSingleQuery()
            .FirstOrDefaultAsync(o => o.Id == id, cancellationToken);
    }

    public Task<Order?> GetByIdForReadAsync(int id, CancellationToken cancellationToken = default)
    {
        return WithOrderGraph(_db.Orders)
            .AsSplitQuery()
            .AsNoTracking()
            .FirstOrDefaultAsync(o => o.Id == id, cancellationToken);
    }

    public Task<List<Order>> GetByDateRangeAsync(
        DateOnly startDate,
        DateOnly endDate,
        SystemType? systemType = null,
        CancellationToken cancellationToken = default)
    {
        var query = WithOrderGraph(_db.Orders)
            .AsSplitQuery()
            .Where(o => !o.IsCancelled && o.Shifts.Any(s => s.OrderDate >= startDate && s.OrderDate <= endDate));

        if (systemType.HasValue)
        {
            query = query.Where(o => o.SystemType == systemType.Value);
        }

        return query
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

    public Task<Order?> FindInstitutionConflictAsync(
        string? institutionName,
        int? institutionId,
        DateOnly orderDate,
        int? excludeOrderId = null,
        CancellationToken cancellationToken = default)
    {
        var trimmedName = institutionName?.Trim() ?? string.Empty;
        if (!institutionId.HasValue && trimmedName.Length == 0)
        {
            return Task.FromResult<Order?>(null);
        }

        var normalized = trimmedName.ToLowerInvariant();
        var query = _db.Orders.AsNoTracking()
            .Include(o => o.Institution)
            .Where(o =>
                !o.IsCancelled &&
                o.Shifts.Any(s => s.OrderDate == orderDate));

        if (institutionId.HasValue)
        {
            query = query.Where(o => o.InstitutionId == institutionId.Value);
        }
        else
        {
            query = query.Where(o =>
                o.InstitutionName != null &&
                o.InstitutionName.ToLower() == normalized);
        }

        if (excludeOrderId.HasValue)
        {
            query = query.Where(o => o.Id != excludeOrderId.Value);
        }

        return query
            .OrderBy(o => o.Id)
            .FirstOrDefaultAsync(cancellationToken);
    }

    public async Task SyncInstitutionNameAsync(
        int institutionId,
        string name,
        CancellationToken cancellationToken = default)
    {
        await _db.Orders
            .Where(o => o.InstitutionId == institutionId)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(o => o.InstitutionName, name),
                cancellationToken);

        await _db.ToolLoans
            .Where(l => l.InstitutionId == institutionId)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(l => l.InstitutionName, name),
                cancellationToken);
    }

    public Task<List<Order>> GetOrdersForInstitutionAsync(
        int institutionId,
        CancellationToken cancellationToken = default)
    {
        return WithOrderGraph(_db.Orders)
            .AsSplitQuery()
            .AsNoTracking()
            .Where(o => o.InstitutionId == institutionId)
            .OrderByDescending(o => o.Shifts.Min(s => s.OrderDate))
            .ThenByDescending(o => o.Id)
            .ToListAsync(cancellationToken);
    }

    public async Task<HashSet<string>> GetOccupiedEquipmentIdsForShiftsAsync(
        IReadOnlyCollection<OrderShiftDto> shifts,
        int? excludeOrderId = null,
        CancellationToken cancellationToken = default)
    {
        if (shifts.Count == 0)
        {
            return new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        }

        var shiftSet = shifts
            .Select(s => (s.OrderDate, s.TimeSlot))
            .ToHashSet();
        var dates = shiftSet.Select(s => s.OrderDate).Distinct().ToList();
        var timeSlots = shiftSet.Select(s => s.TimeSlot).Distinct().ToList();

        var matches = await (
            from oe in _db.OrderEquipments.AsNoTracking()
            join o in _db.Orders.AsNoTracking() on oe.OrderId equals o.Id
            join os in _db.OrderShifts.AsNoTracking() on o.Id equals os.OrderId
            where !o.IsCancelled
                && (!excludeOrderId.HasValue || o.Id != excludeOrderId.Value)
                && dates.Contains(os.OrderDate)
                && timeSlots.Contains(os.TimeSlot)
            select new { oe.EquipmentDefinitionId, os.OrderDate, os.TimeSlot }
        ).ToListAsync(cancellationToken);

        return matches
            .Where(m => shiftSet.Contains((m.OrderDate, m.TimeSlot)))
            .Select(m => m.EquipmentDefinitionId)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
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

        var query = _db.Orders
            .AsNoTracking()
            .Include(o => o.Equipments)
            .ThenInclude(e => e.EquipmentDefinition)
            .Include(o => o.Shifts)
            .AsSplitQuery()
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

        var phones = normalizedDigitPhones.Where(p => p.Length > 0).Distinct().ToList();

        return await WithOrderGraph(_db.Orders)
            .AsNoTracking()
            .AsSplitQuery()
            .Where(o => phones.Contains(o.Phone) || (o.Phone2 != null && phones.Contains(o.Phone2)))
            .OrderByDescending(o => o.Shifts.Max(s => s.OrderDate))
            .ThenByDescending(o => o.Id)
            .ToListAsync(cancellationToken);
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

        return await _db.Orders
            .AsNoTracking()
            .Where(o =>
                !o.IsCancelled &&
                o.Shifts.Any(s => s.OrderDate >= todayInclusive) &&
                (set.Contains(o.Phone) || (o.Phone2 != null && set.Contains(o.Phone2))))
            .AnyAsync(cancellationToken);
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
            .Where(o => o.IsUnpaid)
            .OrderByDescending(o => o.Shifts.Max(s => s.OrderDate))
            .ThenByDescending(o => o.Id)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public Task<List<Order>> GetQuickLoansAsync(CancellationToken cancellationToken = default)
    {
        return WithOrderGraph(_db.Orders)
            .AsSplitQuery()
            .Where(o =>
                !o.IsCancelled
                && o.IsUnpaid
                && !o.Equipments.Any()
                && o.LoanedEquipments.Any(le => le.Quantity > 0))
            .OrderByDescending(o => o.CreatedAt)
            .ThenByDescending(o => o.Id)
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public async Task<List<UnreturnedItemDto>> GetUnreturnedItemsAsync(CancellationToken cancellationToken = default)
    {
        var rows = await _db.Orders
            .AsNoTracking()
            .Where(o => !o.IsCancelled && o.IsReturnProcessed)
            .SelectMany(o => o.LoanedEquipments
                .Where(le => le.Quantity > 0 && le.ReturnedQuantity < le.Quantity)
                .Select(le => new
                {
                    Order = o,
                    Line = le,
                    ReturnDate = o.Shifts.Max(s => (DateOnly?)s.OrderDate),
                    Notes = le.Notes.Select(n => new { n.Content, n.IsReturned }).ToList()
                }))
            .OrderBy(r => r.ReturnDate ?? DateOnly.MinValue)
            .ThenBy(r => r.Order.Id)
            .ThenBy(r => r.Line.Id)
            .ToListAsync(cancellationToken);

        var fromOrders = rows.Select(r =>
        {
            var assignedSerialCodes = r.Notes
                .Select(n => (n.Content ?? string.Empty).Trim())
                .Where(c => c.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
                .ToList();

            var missingSerialCodes = r.Notes
                .Where(n => !n.IsReturned)
                .Select(n => (n.Content ?? string.Empty).Trim())
                .Where(c => c.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
                .ToList();

            return new UnreturnedItemDto
            {
                ManualItemId = null,
                OrderId = r.Order.Id,
                CustomerName = r.Order.CustomerName,
                Phone = r.Order.Phone,
                LoanedEquipmentId = r.Line.Id,
                IsCustomItem = r.Line.IsCustomItem,
                LoanedEquipmentType = r.Line.LoanedEquipmentType,
                EquipmentName = OrderMapper.GetLoanedEquipmentDisplayName(r.Line),
                ReturnDate = r.ReturnDate ?? DateOnly.MinValue,
                QuantityLoaned = r.Line.Quantity,
                MissingQuantity = r.Line.Quantity - r.Line.ReturnedQuantity,
                MissingSerialCodes = missingSerialCodes,
                AssignedSerialCodes = assignedSerialCodes
            };
        }).ToList();

        var manual = await _db.ManualUnreturnedItems
            .AsNoTracking()
            .Where(m => !m.IsResolved)
            .OrderByDescending(m => m.CreatedAt)
            .ThenBy(m => m.Id)
            .ToListAsync(cancellationToken);

        var fromManual = manual.Select(ToManualUnreturnedDto).ToList();
        return fromManual.Concat(fromOrders).ToList();
    }

    public async Task<UnreturnedItemDto> CreateManualUnreturnedItemAsync(
        CreateManualUnreturnedItemDto dto,
        CancellationToken cancellationToken = default)
    {
        var code = (dto.ItemCode ?? string.Empty).Trim();
        if (code.Length == 0)
        {
            throw new ValidationException("יש להזין קוד פריט");
        }

        string itemName = (dto.ItemName ?? string.Empty).Trim();
        LoanedEquipmentType? linkedType = dto.LoanedEquipmentType;
        int? inventoryDefinitionId = dto.InventoryDefinitionId is > 0 ? dto.InventoryDefinitionId : null;

        if (inventoryDefinitionId.HasValue)
        {
            var def = await _db.InventoryDefinitions
                .AsNoTracking()
                .FirstOrDefaultAsync(d => d.Id == inventoryDefinitionId.Value, cancellationToken)
                ?? throw new ValidationException("סוג הפריט לא נמצא");

            if (itemName.Length == 0)
            {
                itemName = def.DisplayName.Trim();
            }

            linkedType ??= def.LinkedEquipmentType;
        }

        if (itemName.Length == 0 && linkedType.HasValue)
        {
            itemName = LoanedEquipmentTypeLabels.GetLabel(linkedType.Value);
        }

        if (itemName.Length == 0)
        {
            throw new ValidationException("יש לבחור פריט");
        }

        var duplicate = await _db.ManualUnreturnedItems.AnyAsync(
            m => !m.IsResolved && m.ItemCode == code,
            cancellationToken);
        if (duplicate)
        {
            throw new ValidationException("קוד פריט זה כבר רשום כפריט שלא חזר");
        }

        var entity = new ManualUnreturnedItem
        {
            InventoryDefinitionId = inventoryDefinitionId,
            LoanedEquipmentType = linkedType,
            ItemName = itemName,
            ItemCode = code,
            IsResolved = false,
            CreatedAt = DateTime.UtcNow
        };

        _db.ManualUnreturnedItems.Add(entity);
        await _db.SaveChangesAsync(cancellationToken);
        return ToManualUnreturnedDto(entity);
    }

    public async Task ResolveManualUnreturnedItemAsync(int manualItemId, CancellationToken cancellationToken = default)
    {
        if (manualItemId <= 0)
        {
            throw new ValidationException("מזהה פריט לא תקין");
        }

        var entity = await _db.ManualUnreturnedItems
            .FirstOrDefaultAsync(m => m.Id == manualItemId, cancellationToken)
            ?? throw new NotFoundException("הפריט לא נמצא");

        if (entity.IsResolved)
        {
            return;
        }

        entity.IsResolved = true;
        await _db.SaveChangesAsync(cancellationToken);
    }

    private static UnreturnedItemDto ToManualUnreturnedDto(ManualUnreturnedItem m)
    {
        var code = (m.ItemCode ?? string.Empty).Trim();
        return new UnreturnedItemDto
        {
            ManualItemId = m.Id,
            OrderId = 0,
            CustomerName = null,
            Phone = string.Empty,
            LoanedEquipmentId = 0,
            IsCustomItem = true,
            LoanedEquipmentType = m.LoanedEquipmentType,
            EquipmentName = m.ItemName,
            ReturnDate = DateOnly.FromDateTime(m.CreatedAt.ToUniversalTime()),
            QuantityLoaned = 1,
            MissingQuantity = 1,
            MissingSerialCodes = code.Length > 0 ? [code] : [],
            AssignedSerialCodes = code.Length > 0 ? [code] : []
        };
    }

    private static IQueryable<Order> WithOrderGraph(IQueryable<Order> query)
    {
        return query
            .Include(o => o.Institution)
            .Include(o => o.Equipments)
            .ThenInclude(e => e.EquipmentDefinition)
            .Include(o => o.Shifts)
            .Include(o => o.LoanedEquipments)
            .ThenInclude(le => le.Notes);
    }
}
