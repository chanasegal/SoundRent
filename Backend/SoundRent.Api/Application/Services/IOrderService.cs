using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.Services;

public interface IOrderService
{
    Task<OrderDto?> GetByIdAsync(int id, CancellationToken cancellationToken = default);

    Task<List<OrderDto>> GetWeeklyOrdersAsync(DateOnly startDate, CancellationToken cancellationToken = default);

    /// <summary>Every order in the database (any date), for full Excel backup.</summary>
    Task<List<OrderDto>> GetAllOrdersForExportAsync(CancellationToken cancellationToken = default);

    Task<OrderDto> CreateOrderAsync(OrderCreateUpdateDto dto, CancellationToken cancellationToken = default);

    Task<OrderDto> UpdateOrderAsync(int id, OrderCreateUpdateDto dto, CancellationToken cancellationToken = default);

    Task DeleteOrderAsync(int id, CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns <c>true</c> when an order already exists for the given
    /// equipment/date/timeSlot triple. Optionally excludes a specific order id
    /// (used in edit mode so the order being edited doesn't conflict with itself).
    /// </summary>
    Task<bool> IsSlotTakenAsync(
        string equipmentType,
        DateOnly orderDate,
        TimeSlot timeSlot,
        int? excludeOrderId,
        CancellationToken cancellationToken = default);
}
