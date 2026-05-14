using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Mapping;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Application.Services;

public class OrderService : IOrderService
{
    private readonly IOrderRepository _orderRepository;
    private readonly IEquipmentDefinitionRepository _equipmentDefinitions;
    private readonly ICustomerService _customerService;

    public OrderService(
        IOrderRepository orderRepository,
        IEquipmentDefinitionRepository equipmentDefinitions,
        ICustomerService customerService)
    {
        _orderRepository = orderRepository;
        _equipmentDefinitions = equipmentDefinitions;
        _customerService = customerService;
    }

    public async Task<OrderDto?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        var order = await _orderRepository.GetByIdAsync(id, cancellationToken);
        return order is null ? null : OrderMapper.ToDto(order);
    }

    public async Task<List<OrderDto>> GetWeeklyOrdersAsync(DateOnly startDate, CancellationToken cancellationToken = default)
    {
        var endDate = startDate.AddDays(6);
        var orders = await _orderRepository.GetByDateRangeAsync(startDate, endDate, cancellationToken);
        return orders.Select(OrderMapper.ToDto).ToList();
    }

    public async Task<List<OrderDto>> GetAllOrdersForExportAsync(CancellationToken cancellationToken = default)
    {
        var orders = await _orderRepository.GetAllForExportAsync(cancellationToken);
        return orders.Select(OrderMapper.ToDto).ToList();
    }

    public async Task<OrderDto> CreateOrderAsync(OrderCreateUpdateDto dto, CancellationToken cancellationToken = default)
    {
        ValidateDayAndSlotRules(dto.OrderDate, dto.TimeSlot);
        await ValidateBookingSlotExistsAsync(dto.EquipmentType, cancellationToken);
        await ValidateMaintenanceModeForCreateAsync(dto.EquipmentType, cancellationToken);

        var slotTaken = await _orderRepository.ExistsForSlotAsync(
            dto.EquipmentType.Trim(), dto.OrderDate, dto.TimeSlot, excludeOrderId: null, cancellationToken);

        if (slotTaken && !dto.AllowDoubleBooking)
        {
            throw new ValidationException("מועד זה כבר תפוס עבור ציוד זה");
        }

        var entity = OrderMapper.ToEntity(dto);
        await _orderRepository.AddAsync(entity, cancellationToken);
        await _orderRepository.SaveChangesAsync(cancellationToken);
        await _customerService.SyncFromOrderAsync(dto, cancellationToken);

        return OrderMapper.ToDto(entity);
    }

    public async Task<OrderDto> UpdateOrderAsync(int id, OrderCreateUpdateDto dto, CancellationToken cancellationToken = default)
    {
        var existing = await _orderRepository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("ההזמנה לא נמצאה");

        ValidateDayAndSlotRules(dto.OrderDate, dto.TimeSlot);
        await ValidateBookingSlotExistsAsync(dto.EquipmentType, cancellationToken);
        await ValidateMaintenanceModeForCreateAsync(dto.EquipmentType, cancellationToken);

        var slotTaken = await _orderRepository.ExistsForSlotAsync(
            dto.EquipmentType.Trim(), dto.OrderDate, dto.TimeSlot, excludeOrderId: id, cancellationToken);

        if (slotTaken && !dto.AllowDoubleBooking)
        {
            throw new ValidationException("מועד זה כבר תפוס עבור ציוד זה");
        }

        OrderMapper.ApplyTo(dto, existing);

        // Replace child collection (simple, predictable strategy for an admin tool).
        existing.LoanedEquipments.Clear();
        foreach (var item in dto.LoanedEquipments)
        {
            existing.LoanedEquipments.Add(OrderMapper.ToEntity(item));
        }

        await _orderRepository.SaveChangesAsync(cancellationToken);
        await _customerService.SyncFromOrderAsync(dto, cancellationToken);
        return OrderMapper.ToDto(existing);
    }

    public async Task DeleteOrderAsync(int id, CancellationToken cancellationToken = default)
    {
        var existing = await _orderRepository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("ההזמנה לא נמצאה");

        _orderRepository.Remove(existing);
        await _orderRepository.SaveChangesAsync(cancellationToken);
    }

    public async Task<bool> IsSlotTakenAsync(
        string equipmentType,
        DateOnly orderDate,
        TimeSlot timeSlot,
        int? excludeOrderId,
        CancellationToken cancellationToken = default)
    {
        if (!await _equipmentDefinitions.ExistsAsync(equipmentType, cancellationToken))
        {
            return false;
        }

        return await _orderRepository.ExistsForSlotAsync(
            equipmentType.Trim(), orderDate, timeSlot, excludeOrderId, cancellationToken);
    }

    private static void ValidateDayAndSlotRules(DateOnly orderDate, TimeSlot timeSlot)
    {
        // Friday → Morning only.
        if (orderDate.DayOfWeek == DayOfWeek.Friday && timeSlot != TimeSlot.Morning)
        {
            throw new ValidationException("ביום שישי ניתן להזמין רק במשמרת בוקר");
        }

        // Saturday (Saturday Night) → Evening only.
        if (orderDate.DayOfWeek == DayOfWeek.Saturday && timeSlot != TimeSlot.Evening)
        {
            throw new ValidationException("במוצאי שבת ניתן להזמין רק במשמרת ערב");
        }
    }

    private async Task ValidateMaintenanceModeForCreateAsync(
        string bookingSlot,
        CancellationToken cancellationToken)
    {
        var trimmed = bookingSlot.Trim();
        var def = await _equipmentDefinitions.GetByIdAsync(trimmed, cancellationToken);
        if (def is null || !def.IsMaintenanceMode)
        {
            return;
        }

        throw new ValidationException("הציוד בתיקון - לא ניתן להוסיף הזמנה חדשה");
    }

    private async Task ValidateBookingSlotExistsAsync(string? slot, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(slot) || !await _equipmentDefinitions.ExistsAsync(slot, cancellationToken))
        {
            throw new ValidationException("יש לבחור ערך ציוד תקין מהרשימה");
        }
    }
}
