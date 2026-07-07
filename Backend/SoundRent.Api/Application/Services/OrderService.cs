using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Mapping;
using SoundRent.Api.Application.PhoneNumbers;
using SoundRent.Api.Application.Validation;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Application.Services;

public class OrderService : IOrderService
{
    private readonly IOrderRepository _orderRepository;
    private readonly IEquipmentDefinitionRepository _equipmentDefinitions;
    private readonly ICustomerService _customerService;
    private readonly IBlockedDateRepository _blockedDates;

    public OrderService(
        IOrderRepository orderRepository,
        IEquipmentDefinitionRepository equipmentDefinitions,
        ICustomerService customerService,
        IBlockedDateRepository blockedDates)
    {
        _orderRepository = orderRepository;
        _equipmentDefinitions = equipmentDefinitions;
        _customerService = customerService;
        _blockedDates = blockedDates;
    }

    public async Task<OrderDto?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        var order = await _orderRepository.GetByIdForReadAsync(id, cancellationToken);
        return order is null ? null : OrderMapper.ToDto(order);
    }

    public async Task<List<OrderDto>> GetWeeklyOrdersAsync(
        DateOnly startDate,
        DateOnly endDate,
        CancellationToken cancellationToken = default)
    {
        if (endDate < startDate)
        {
            throw new ValidationException("תאריך הסיום חייב להיות באותו יום או אחרי תאריך ההתחלה");
        }

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
        NormalizeAndValidateOrderPhones(dto);
        ExtendMorningEndShiftForLateReturn(dto);
        ValidateLoanedEquipments(dto.LoanedEquipments);
        var equipmentIds = OrderMapper.NormalizeEquipmentDefinitionIds(dto.EquipmentDefinitionIds);
        var shifts = OrderMapper.NormalizeShifts(dto.Shifts);
        await ValidateReservationRequestAsync(
            equipmentIds,
            shifts,
            excludeOrderId: null,
            allowDoubleBooking: dto.AllowDoubleBooking,
            priorEquipmentIds: null,
            validateBlockedDates: true,
            cancellationToken);

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

        NormalizeAndValidateOrderPhones(dto);
        ExtendMorningEndShiftForLateReturn(dto);
        ValidateLoanedEquipments(dto.LoanedEquipments);
        var equipmentIds = OrderMapper.NormalizeEquipmentDefinitionIds(dto.EquipmentDefinitionIds);
        var shifts = OrderMapper.NormalizeShifts(dto.Shifts);
        var priorEquipmentIds = OrderMapper
            .NormalizeEquipmentDefinitionIds(existing.Equipments.Select(e => e.EquipmentDefinitionId))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        await ValidateReservationRequestAsync(
            equipmentIds,
            shifts,
            excludeOrderId: id,
            allowDoubleBooking: dto.AllowDoubleBooking,
            priorEquipmentIds,
            validateBlockedDates: false,
            cancellationToken);

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

        var priorReturns = existing.LoanedEquipments
            .ToDictionary(le => le.Id, le => le.ReturnedQuantity);
        SyncLoanedEquipments(existing, dto.LoanedEquipments, priorReturns);

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

        existing.IsUnpaid = false;
        await _orderRepository.SaveChangesAsync(cancellationToken);
        return OrderMapper.ToDto(existing);
    }

    public async Task<OrderDto> RecordReturnAsync(
        int id,
        OrderReturnRequestDto request,
        CancellationToken cancellationToken = default)
    {
        var items = request.Items ?? [];
        if (items.Count == 0)
        {
            throw new ValidationException("יש לספק לפחות פריט אחד להחזרה");
        }

        var existing = await _orderRepository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("ההזמנה לא נמצאה");

        if (existing.IsCancelled)
        {
            throw new ValidationException("לא ניתן לרשום החזרה להזמנה מבוטלת");
        }

        var byLineId = existing.LoanedEquipments.ToDictionary(le => le.Id);

        foreach (var item in items)
        {
            if (!byLineId.TryGetValue(item.LoanedEquipmentId, out var line))
            {
                throw new ValidationException("פריט מושאל לא נמצא בהזמנה");
            }

            var label = OrderMapper.GetLoanedEquipmentDisplayName(line);
            if (item.QuantityReturned < 0 || item.QuantityReturned > line.Quantity)
            {
                throw new ValidationException(
                    $"כמות ההחזרה עבור {label} חייבת להיות בין 0 ל-{line.Quantity}");
            }

            line.ReturnedQuantity = item.QuantityReturned;
        }

        existing.IsReturnProcessed = true;
        await _orderRepository.SaveChangesAsync(cancellationToken);
        return OrderMapper.ToDto(existing);
    }

    public Task<List<UnreturnedItemDto>> GetUnreturnedItemsAsync(CancellationToken cancellationToken = default)
    {
        return _orderRepository.GetUnreturnedItemsAsync(cancellationToken);
    }

    private static void ValidateLoanedEquipments(IReadOnlyCollection<OrderLoanedEquipmentDto> items)
    {
        foreach (var item in items)
        {
            if (item.IsCustomItem)
            {
                if (string.IsNullOrWhiteSpace(item.CustomItemName))
                {
                    throw new ValidationException("יש להזין שם לפריט חופשי");
                }

                if (item.Quantity < 1)
                {
                    throw new ValidationException($"כמות עבור \"{item.CustomItemName.Trim()}\" חייבת להיות לפחות 1");
                }

                continue;
            }

            if (item.LoanedEquipmentType is null)
            {
                throw new ValidationException("סוג ציוד מושאל חסר");
            }
        }
    }

    private static void SyncLoanedEquipments(
        Order order,
        IEnumerable<OrderLoanedEquipmentDto> incomingDtos,
        IReadOnlyDictionary<int, int>? priorReturnsById = null)
    {
        var incoming = incomingDtos.ToList();
        var matched = new HashSet<OrderLoanedEquipment>();

        foreach (var dto in incoming)
        {
            if (dto.IsCustomItem)
            {
                if (dto.Quantity < 1)
                {
                    continue;
                }
            }
            else if (dto.Quantity <= 0)
            {
                continue;
            }

            OrderLoanedEquipment? line = null;
            if (dto.Id > 0)
            {
                line = order.LoanedEquipments.FirstOrDefault(l => l.Id == dto.Id);
            }

            if (line is null && !dto.IsCustomItem && dto.LoanedEquipmentType is LoanedEquipmentType type)
            {
                line = order.LoanedEquipments.FirstOrDefault(l => !l.IsCustomItem && l.LoanedEquipmentType == type);
            }

            if (line is not null)
            {
                var returned = line.ReturnedQuantity;
                ApplyLoanedEquipmentDto(line, dto);
                if (priorReturnsById is not null && priorReturnsById.TryGetValue(line.Id, out var priorReturned))
                {
                    returned = priorReturned;
                }

                line.ReturnedQuantity = Math.Min(returned, line.Quantity);
                matched.Add(line);
                continue;
            }

            var created = OrderMapper.ToEntity(dto);
            order.LoanedEquipments.Add(created);
            matched.Add(created);
        }

        foreach (var stale in order.LoanedEquipments.Where(l => !matched.Contains(l)).ToList())
        {
            order.LoanedEquipments.Remove(stale);
        }
    }

    private static void ApplyLoanedEquipmentDto(OrderLoanedEquipment line, OrderLoanedEquipmentDto dto)
    {
        if (dto.IsCustomItem)
        {
            line.IsCustomItem = true;
            line.CustomItemName = dto.CustomItemName?.Trim();
            line.LoanedEquipmentType = null;
            line.Quantity = dto.Quantity;
            line.ExpectedNoteCount = 0;
            line.Notes.Clear();
            return;
        }

        line.IsCustomItem = false;
        line.CustomItemName = null;
        line.LoanedEquipmentType = dto.LoanedEquipmentType;
        line.Quantity = dto.Quantity;

        var expected = Math.Max(0, dto.ExpectedNoteCount);
        line.ExpectedNoteCount = expected;
        line.Notes.Clear();

        var byOrdinal = (dto.Notes ?? [])
            .GroupBy(n => n.Ordinal)
            .ToDictionary(g => g.Key, g => g.First());

        for (var i = 0; i < expected; i++)
        {
            byOrdinal.TryGetValue(i, out var noteDto);
            line.Notes.Add(new LoanedEquipmentNote
            {
                Ordinal = i,
                Content = string.IsNullOrWhiteSpace(noteDto?.Content) ? null : noteDto.Content.Trim()
            });
        }
    }

    private static void NormalizeAndValidateOrderPhones(OrderCreateUpdateDto dto)
    {
        if (!IsraeliPhoneValidator.TryNormalizeRequired(dto.Phone, out var p1))
        {
            throw new ValidationException(IsraeliPhoneValidator.InvalidPhoneMessage);
        }

        if (!IsraeliPhoneValidator.TryNormalizeOptional(dto.Phone2, out var p2))
        {
            throw new ValidationException(IsraeliPhoneValidator.InvalidPhoneMessage);
        }

        dto.Phone = p1;
        dto.Phone2 = p2;
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
        bool allowDoubleBooking,
        IReadOnlySet<string>? priorEquipmentIds,
        bool validateBlockedDates,
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

        await ValidateShiftsNotBlockedAsync(shifts, validateBlockedDates, cancellationToken);

        var definitions = await _equipmentDefinitions.GetByIdsAsync(equipmentIds, cancellationToken);
        var definitionsById = definitions.ToDictionary(d => d.Id, StringComparer.OrdinalIgnoreCase);

        foreach (var equipmentId in equipmentIds)
        {
            var trimmed = equipmentId.Trim();
            if (!definitionsById.TryGetValue(trimmed, out var def))
            {
                throw new ValidationException("יש לבחור ערך ציוד תקין מהרשימה");
            }

            if (priorEquipmentIds?.Contains(equipmentId) == true)
            {
                continue;
            }

            if (def.IsMaintenanceMode)
            {
                throw new ValidationException("הציוד בתיקון - לא ניתן להוסיף הזמנה חדשה");
            }
        }

        if (allowDoubleBooking)
        {
            return;
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

    private async Task ValidateShiftsNotBlockedAsync(
        IReadOnlyList<OrderShiftDto> shifts,
        bool validateBlockedDates,
        CancellationToken cancellationToken)
    {
        if (!validateBlockedDates)
        {
            return;
        }

        var uniqueDates = shifts.Select(s => s.OrderDate).Distinct().ToList();
        foreach (var date in uniqueDates)
        {
            if (await _blockedDates.AnyBlockCoversDateAsync(date, cancellationToken))
            {
                throw new ValidationException(
                    $"התאריך {date:yyyy-MM-dd} חסום להזמנות חדשות");
            }
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
