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
        ExtendMorningEndShiftForLateReturn(dto);
        var equipmentIds = OrderMapper.NormalizeEquipmentDefinitionIds(dto.EquipmentDefinitionIds);
        var shifts = OrderMapper.NormalizeShifts(dto.Shifts);
        await ValidateReservationRequestAsync(equipmentIds, shifts, excludeOrderId: null, cancellationToken);

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

        ExtendMorningEndShiftForLateReturn(dto);
        var equipmentIds = OrderMapper.NormalizeEquipmentDefinitionIds(dto.EquipmentDefinitionIds);
        var shifts = OrderMapper.NormalizeShifts(dto.Shifts);
        await ValidateReservationRequestAsync(equipmentIds, shifts, excludeOrderId: id, cancellationToken);

        OrderMapper.ApplyTo(dto, existing);

        // Replace child collections (simple, predictable strategy for an admin tool).
        existing.Equipments.Clear();
        foreach (var equipmentId in equipmentIds)
        {
            existing.Equipments.Add(OrderMapper.ToEntity(equipmentId));
        }

        existing.Shifts.Clear();
        foreach (var shift in shifts)
        {
            existing.Shifts.Add(OrderMapper.ToEntity(shift));
        }

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

    public async Task<List<OrderDto>> GetCancelledOrdersAsync(CancellationToken cancellationToken = default)
    {
        var orders = await _orderRepository.GetCancelledOrdersAsync(cancellationToken);
        return orders.Select(OrderMapper.ToDto).ToList();
    }

    public async Task<List<OrderDto>> GetUnpaidOrdersAsync(CancellationToken cancellationToken = default)
    {
        var orders = await _orderRepository.GetUnpaidOrdersAsync(cancellationToken);
        return orders.Select(OrderMapper.ToDto).ToList();
    }

    public async Task<OrderDto> CancelOrderAsync(int id, CancellationToken cancellationToken = default)
    {
        var existing = await _orderRepository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("ההזמנה לא נמצאה");

        if (existing.IsCancelled)
        {
            throw new ValidationException("ההזמנה כבר בוטלה");
        }

        existing.IsCancelled = true;
        await _orderRepository.SaveChangesAsync(cancellationToken);
        return OrderMapper.ToDto(existing);
    }

    public async Task<OrderDto> MarkOrderAsPaidAsync(int id, CancellationToken cancellationToken = default)
    {
        var existing = await _orderRepository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("ההזמנה לא נמצאה");

        existing.IsPaid = true;
        await _orderRepository.SaveChangesAsync(cancellationToken);
        return OrderMapper.ToDto(existing);
    }

    private static void ValidateDayAndSlotRules(DateOnly orderDate, TimeSlot timeSlot)
    {
        if (orderDate == default)
        {
            throw new ValidationException("יש להזין תאריך הזמנה");
        }

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

    private async Task ValidateReservationRequestAsync(
        IReadOnlyList<string> equipmentIds,
        IReadOnlyList<OrderShiftDto> shifts,
        int? excludeOrderId,
        CancellationToken cancellationToken)
    {
        if (equipmentIds.Count == 0)
        {
            throw new ValidationException("יש לבחור לפחות ציוד אחד");
        }

        if (shifts.Count == 0)
        {
            throw new ValidationException("יש לבחור לפחות מועד אחד");
        }

        if (!AreShiftsStrictlyConsecutive(shifts))
        {
            throw new ValidationException("הזמנה בודדת חייבת להכיל מועדים רצופים בלבד");
        }

        foreach (var shift in shifts)
        {
            ValidateDayAndSlotRules(shift.OrderDate, shift.TimeSlot);
        }

        foreach (var equipmentId in equipmentIds)
        {
            await ValidateBookingSlotExistsAsync(equipmentId, cancellationToken);
            await ValidateMaintenanceModeForCreateAsync(equipmentId, cancellationToken);
        }

        var conflict = await _orderRepository.FindSlotConflictAsync(
            equipmentIds, shifts, excludeOrderId, cancellationToken);
        if (conflict is not null)
        {
            var equipmentLabel = string.IsNullOrWhiteSpace(conflict.EquipmentDisplayName)
                ? conflict.EquipmentDefinitionId
                : conflict.EquipmentDisplayName;
            throw new ValidationException(
                $"הציוד {equipmentLabel} כבר תפוס בתאריך {conflict.OrderDate:yyyy-MM-dd} במשמרת {ShiftLabel(conflict.TimeSlot)}");
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

    private static string ShiftLabel(TimeSlot timeSlot) => timeSlot switch
    {
        TimeSlot.Morning => "בוקר",
        TimeSlot.Evening => "ערב",
        _ => timeSlot.ToString()
    };

    private static void ExtendMorningEndShiftForLateReturn(OrderCreateUpdateDto dto)
    {
        if (dto.ReturnTimeType is not (ReturnTimeType.LateNight or ReturnTimeType.NextMorning))
        {
            return;
        }

        var shifts = OrderMapper.NormalizeShifts(dto.Shifts);
        var lastShift = shifts.LastOrDefault();
        if (lastShift is null || lastShift.TimeSlot != TimeSlot.Morning)
        {
            return;
        }

        dto.Shifts = OrderMapper.NormalizeShifts(shifts.Append(new OrderShiftDto
        {
            OrderDate = lastShift.OrderDate,
            TimeSlot = TimeSlot.Evening
        })).ToList();
    }

    private static bool AreShiftsStrictlyConsecutive(IReadOnlyList<OrderShiftDto> shifts)
    {
        if (shifts.Count <= 1)
        {
            return true;
        }

        var ordered = shifts
            .OrderBy(s => s.OrderDate)
            .ThenBy(s => ShiftOrder(s.TimeSlot))
            .ToList();
        var expected = GenerateContinuousShifts(
            ordered[0].OrderDate,
            ordered[0].TimeSlot,
            ordered[^1].OrderDate,
            ordered[^1].TimeSlot);

        if (expected.Count != ordered.Count)
        {
            return false;
        }

        for (var i = 0; i < expected.Count; i++)
        {
            if (expected[i].OrderDate != ordered[i].OrderDate ||
                expected[i].TimeSlot != ordered[i].TimeSlot)
            {
                return false;
            }
        }

        return true;
    }

    private static List<OrderShiftDto> GenerateContinuousShifts(
        DateOnly startDate,
        TimeSlot startShift,
        DateOnly endDate,
        TimeSlot endShift)
    {
        var result = new List<OrderShiftDto>();
        for (var date = startDate; date <= endDate; date = date.AddDays(1))
        {
            foreach (var shift in ValidShiftsForDate(date))
            {
                if (CompareShift(date, shift, startDate, startShift) >= 0 &&
                    CompareShift(date, shift, endDate, endShift) <= 0)
                {
                    result.Add(new OrderShiftDto { OrderDate = date, TimeSlot = shift });
                }
            }
        }

        return result;
    }

    private static IReadOnlyList<TimeSlot> ValidShiftsForDate(DateOnly date)
    {
        return date.DayOfWeek switch
        {
            DayOfWeek.Friday => [TimeSlot.Morning],
            DayOfWeek.Saturday => [TimeSlot.Evening],
            _ => [TimeSlot.Morning, TimeSlot.Evening]
        };
    }

    private static int CompareShift(DateOnly aDate, TimeSlot aShift, DateOnly bDate, TimeSlot bShift)
    {
        var dateCompare = aDate.CompareTo(bDate);
        return dateCompare != 0 ? dateCompare : ShiftOrder(aShift).CompareTo(ShiftOrder(bShift));
    }

    private static int ShiftOrder(TimeSlot shift)
    {
        return shift == TimeSlot.Morning ? 1 : 2;
    }
}
