using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Infrastructure.Repositories;

public interface IOrderRepository
{
    Task<Order?> GetByIdAsync(int id, CancellationToken cancellationToken = default);

    /// <summary>Read-only order fetch with full graph (no change tracking).</summary>
    Task<Order?> GetByIdForReadAsync(int id, CancellationToken cancellationToken = default);

    Task<List<Order>> GetByDateRangeAsync(DateOnly startDate, DateOnly endDate, CancellationToken cancellationToken = default);

    /// <summary>All orders with loaned-equipment graph (backup / full export).</summary>
    Task<List<Order>> GetAllForExportAsync(CancellationToken cancellationToken = default);

    Task<bool> ExistsForSlotAsync(string equipmentType, DateOnly orderDate, TimeSlot timeSlot, int? excludeOrderId = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Equipment definition ids that are booked on at least one of the given shifts.
    /// </summary>
    Task<HashSet<string>> GetOccupiedEquipmentIdsForShiftsAsync(
        IReadOnlyCollection<OrderShiftDto> shifts,
        int? excludeOrderId = null,
        CancellationToken cancellationToken = default);

    Task<OrderSlotConflictDto?> FindSlotConflictAsync(
        IReadOnlyCollection<string> equipmentDefinitionIds,
        IReadOnlyCollection<OrderShiftDto> shifts,
        int? excludeOrderId = null,
        CancellationToken cancellationToken = default);

    Task<IReadOnlyList<EquipmentDefinitionDeleteFutureOrderDto>> GetFutureOrdersForEquipmentTypeAsync(
        string equipmentType,
        DateOnly todayInclusive,
        CancellationToken cancellationToken = default);

    Task<int> DeleteOrdersForEquipmentTypeBeforeDateAsync(
        string equipmentType,
        DateOnly beforeExclusive,
        CancellationToken cancellationToken = default);

    Task AddAsync(Order order, CancellationToken cancellationToken = default);

    void Remove(Order order);

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);

    /// <summary>Orders whose primary or secondary phone matches any of the given digit strings.</summary>
    Task<List<Order>> GetOrdersForCustomerPhonesAsync(
        IReadOnlyCollection<string> normalizedDigitPhones,
        CancellationToken cancellationToken = default);

    Task<bool> HasActiveOrFutureOrdersForCustomerPhonesAsync(
        IReadOnlyCollection<string> normalizedDigitPhones,
        DateOnly todayInclusive,
        CancellationToken cancellationToken = default);

    Task<List<Order>> GetCancelledOrdersAsync(CancellationToken cancellationToken = default);

    Task<List<Order>> GetUnpaidOrdersAsync(CancellationToken cancellationToken = default);

    Task<List<UnreturnedItemDto>> GetUnreturnedItemsAsync(CancellationToken cancellationToken = default);
}
