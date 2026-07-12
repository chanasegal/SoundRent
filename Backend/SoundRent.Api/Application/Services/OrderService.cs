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
    private readonly IAccessorySerialInventoryService _accessorySerialInventory;
    private readonly IInstitutionRepository _institutions;

    public OrderService(
        IOrderRepository orderRepository,
        IEquipmentDefinitionRepository equipmentDefinitions,
        ICustomerService customerService,
        IBlockedDateRepository blockedDates,
        IAccessorySerialInventoryService accessorySerialInventory,
        IInstitutionRepository institutions)
    {
        _orderRepository = orderRepository;
        _equipmentDefinitions = equipmentDefinitions;
        _customerService = customerService;
        _blockedDates = blockedDates;
        _accessorySerialInventory = accessorySerialInventory;
        _institutions = institutions;
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
        await ResolveInstitutionAsync(dto, cancellationToken);
        ExtendMorningEndShiftForLateReturn(dto);
        ValidateLoanedEquipments(dto.LoanedEquipments);
        var equipmentIds = OrderMapper.NormalizeEquipmentDefinitionIds(dto.EquipmentDefinitionIds);
        var shifts = OrderMapper.NormalizeShifts(dto.Shifts);
        await _accessorySerialInventory.ValidateOrderLoanedSerialsAsync(
            dto.LoanedEquipments,
            shifts,
            excludeOrderId: null,
            cancellationToken);
        var allowAccessoryOnly =
            (dto.LoanedEquipments ?? []).Any(le => le.Quantity > 0);
        await ValidateReservationRequestAsync(
            equipmentIds,
            shifts,
            excludeOrderId: null,
            allowDoubleBooking: dto.AllowDoubleBooking,
            priorEquipmentIds: null,
            validateBlockedDates: true,
            allowAccessoryOnlyLoan: allowAccessoryOnly,
            cancellationToken);

        var entity = OrderMapper.ToEntity(dto);
        await _orderRepository.AddAsync(entity, cancellationToken);
        await _accessorySerialInventory.SyncPhysicalStatusForOrderAsync(
            0,
            new Dictionary<LoanedEquipmentType, HashSet<string>>(),
            dto.LoanedEquipments,
            cancellationToken);
        await _orderRepository.SaveChangesAsync(cancellationToken);
        await _customerService.SyncFromOrderAsync(dto, cancellationToken);

        return OrderMapper.ToDto(entity);
    }

    public async Task<OrderDto> UpdateOrderAsync(int id, OrderCreateUpdateDto dto, CancellationToken cancellationToken = default)
    {
        var existing = await _orderRepository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("ההזמנה לא נמצאה");

        NormalizeAndValidateOrderPhones(dto);
        await ResolveInstitutionAsync(dto, cancellationToken);
        ExtendMorningEndShiftForLateReturn(dto);
        ValidateLoanedEquipments(dto.LoanedEquipments);
        var equipmentIds = OrderMapper.NormalizeEquipmentDefinitionIds(dto.EquipmentDefinitionIds);
        var shifts = OrderMapper.NormalizeShifts(dto.Shifts);
        MergeReturnedSerialStateFromExisting(existing, dto.LoanedEquipments);
        await _accessorySerialInventory.ValidateOrderLoanedSerialsAsync(
            dto.LoanedEquipments,
            shifts,
            excludeOrderId: id,
            cancellationToken);
        await _accessorySerialInventory.ValidateReturnedSerialGuardrailsAsync(
            id,
            existing.IsReturnProcessed,
            ExtractReturnedSerialCodesByType(existing),
            dto.LoanedEquipments,
            cancellationToken);
        var priorEquipmentIds = OrderMapper
            .NormalizeEquipmentDefinitionIds(existing.Equipments.Select(e => e.EquipmentDefinitionId))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        var allowAccessoryOnly =
            (dto.LoanedEquipments ?? []).Any(le => le.Quantity > 0)
            || existing.LoanedEquipments.Any(le => le.Quantity > 0);
        await ValidateReservationRequestAsync(
            equipmentIds,
            shifts,
            excludeOrderId: id,
            allowDoubleBooking: dto.AllowDoubleBooking,
            priorEquipmentIds,
            validateBlockedDates: false,
            allowAccessoryOnlyLoan: allowAccessoryOnly,
            cancellationToken);

        var priorAssignedSerials = ExtractAssignedSerialCodesByType(existing);

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

        await _accessorySerialInventory.SyncPhysicalStatusForOrderAsync(
            id,
            priorAssignedSerials,
            dto.LoanedEquipments,
            cancellationToken);
        await _orderRepository.SaveChangesAsync(cancellationToken);
        await _customerService.SyncFromOrderAsync(dto, cancellationToken);
        return OrderMapper.ToDto(existing);
    }

    public async Task DeleteOrderAsync(int id, CancellationToken cancellationToken = default)
    {
        var existing = await _orderRepository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("ההזמנה לא נמצאה");

        await _accessorySerialInventory.ReleaseAllOrderSerialsAsync(id, cancellationToken);
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

    public async Task<InstitutionConflictDto> CheckInstitutionConflictAsync(
        string? institutionName,
        int? institutionId,
        DateOnly orderDate,
        int? excludeOrderId,
        CancellationToken cancellationToken = default)
    {
        if (!institutionId.HasValue && string.IsNullOrWhiteSpace(institutionName))
        {
            return new InstitutionConflictDto { HasConflict = false };
        }

        string? defaultNote = null;
        if (institutionId.HasValue)
        {
            var institution = await _institutions.GetByIdAsync(institutionId.Value, cancellationToken);
            if (institution is null)
            {
                return new InstitutionConflictDto { HasConflict = false };
            }

            institutionName = institution.Name;
            defaultNote = string.IsNullOrWhiteSpace(institution.DefaultNote)
                ? null
                : institution.DefaultNote.Trim();
        }

        var conflict = await _orderRepository.FindInstitutionConflictAsync(
            institutionName,
            institutionId,
            orderDate,
            excludeOrderId,
            cancellationToken);

        if (conflict is null)
        {
            return new InstitutionConflictDto { HasConflict = false };
        }

        if (defaultNote is null)
        {
            defaultNote = string.IsNullOrWhiteSpace(conflict.Institution?.DefaultNote)
                ? (string.IsNullOrWhiteSpace(conflict.Notes) ? null : conflict.Notes.Trim())
                : conflict.Institution!.DefaultNote!.Trim();
        }

        return new InstitutionConflictDto
        {
            HasConflict = true,
            ConflictingOrderId = conflict.Id,
            ConflictingCustomerName = string.IsNullOrWhiteSpace(conflict.CustomerName)
                ? null
                : conflict.CustomerName.Trim(),
            InstitutionNote = defaultNote,
            ConflictDate = orderDate
        };
    }

    private async Task ResolveInstitutionAsync(OrderCreateUpdateDto dto, CancellationToken cancellationToken)
    {
        if (dto.InstitutionId is int institutionId)
        {
            var institution = await _institutions.GetByIdAsync(institutionId, cancellationToken)
                ?? throw new ValidationException("המוסד שנבחר לא נמצא");
            dto.InstitutionId = institution.Id;
            dto.InstitutionName = institution.Name;
            return;
        }

        if (!string.IsNullOrWhiteSpace(dto.InstitutionName))
        {
            var match = await _institutions.FindByNameAsync(dto.InstitutionName, cancellationToken);
            if (match is not null)
            {
                dto.InstitutionId = match.Id;
                dto.InstitutionName = match.Name;
                return;
            }

            dto.InstitutionId = null;
            dto.InstitutionName = dto.InstitutionName.Trim();
            return;
        }

        dto.InstitutionId = null;
        dto.InstitutionName = null;
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

    public async Task<List<OrderDto>> GetQuickLoansAsync(CancellationToken cancellationToken = default)
    {
        var orders = await _orderRepository.GetQuickLoansAsync(cancellationToken);
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
        await _accessorySerialInventory.ReleaseAllOrderSerialsAsync(id, cancellationToken);
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

    public async Task<OrderDto> UpdateUrgentBoardNoteAsync(
        int id,
        string? urgentBoardNote,
        CancellationToken cancellationToken = default)
    {
        var existing = await _orderRepository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("ההזמנה לא נמצאה");

        var trimmed = urgentBoardNote?.Trim();
        existing.UrgentBoardNote = string.IsNullOrEmpty(trimmed) ? null : trimmed;
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
        var returnedSerials = new List<(LoanedEquipmentType EquipmentType, string SerialCode)>();

        foreach (var item in items)
        {
            if (!byLineId.TryGetValue(item.LoanedEquipmentId, out var line))
            {
                throw new ValidationException("פריט מושאל לא נמצא בהזמנה");
            }

            var label = OrderMapper.GetLoanedEquipmentDisplayName(line);
            var assignedCodes = GetAssignedSerialCodes(line);

            if (assignedCodes.Count > 0)
            {
                var returnedCodes = NormalizeReturnedSerialCodes(item.ReturnedSerialCodes, assignedCodes);
                if (returnedCodes.Count != item.QuantityReturned)
                {
                    throw new ValidationException(
                        $"כמות הקודים שהוחזרו עבור {label} חייבת להתאים לכמות שהוחזרה");
                }

                if (returnedCodes.Count > line.Quantity)
                {
                    throw new ValidationException(
                        $"כמות ההחזרה עבור {label} חייבת להיות בין 0 ל-{line.Quantity}");
                }

                var previouslyReturned = GetReturnedSerialCodes(line);
                ApplyReturnedSerialCodes(line, assignedCodes, returnedCodes);
                line.ReturnedQuantity = returnedCodes.Count;
                if (line.LoanedEquipmentType is LoanedEquipmentType equipmentType)
                {
                    foreach (var code in returnedCodes)
                    {
                        if (!previouslyReturned.Contains(code))
                        {
                            returnedSerials.Add((equipmentType, code));
                        }
                    }
                }

                continue;
            }

            if (item.QuantityReturned < 0 || item.QuantityReturned > line.Quantity)
            {
                throw new ValidationException(
                    $"כמות ההחזרה עבור {label} חייבת להיות בין 0 ל-{line.Quantity}");
            }

            line.ReturnedQuantity = item.QuantityReturned;
        }

        existing.IsReturnProcessed = true;
        await _accessorySerialInventory.ReleaseReturnedSerialsAsync(returnedSerials, cancellationToken);
        await _orderRepository.SaveChangesAsync(cancellationToken);
        return OrderMapper.ToDto(existing);
    }

    public Task<List<UnreturnedItemDto>> GetUnreturnedItemsAsync(CancellationToken cancellationToken = default)
    {
        return _orderRepository.GetUnreturnedItemsAsync(cancellationToken);
    }

    private static Dictionary<LoanedEquipmentType, HashSet<string>> ExtractAssignedSerialCodesByType(Order order)
    {
        var result = new Dictionary<LoanedEquipmentType, HashSet<string>>();
        foreach (var line in order.LoanedEquipments)
        {
            if (line.IsCustomItem || line.LoanedEquipmentType is not LoanedEquipmentType type)
            {
                continue;
            }

            if (!result.TryGetValue(type, out var codes))
            {
                codes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                result[type] = codes;
            }

            foreach (var note in line.Notes)
            {
                if (note.IsReturned)
                {
                    continue;
                }

                var code = (note.Content ?? string.Empty).Trim();
                if (code.Length > 0)
                {
                    codes.Add(code);
                }
            }
        }

        return result;
    }

    private static void MergeReturnedSerialStateFromExisting(
        Order existing,
        ICollection<OrderLoanedEquipmentDto> incomingItems)
    {
        var existingLinesById = existing.LoanedEquipments
            .Where(le => le.Id > 0)
            .ToDictionary(le => le.Id);
        var existingLinesByType = existing.LoanedEquipments
            .Where(le => !le.IsCustomItem && le.LoanedEquipmentType is not null)
            .GroupBy(le => le.LoanedEquipmentType!.Value)
            .ToDictionary(g => g.Key, g => g.First());

        foreach (var item in incomingItems)
        {
            if (item.IsCustomItem || item.LoanedEquipmentType is not LoanedEquipmentType type)
            {
                continue;
            }

            OrderLoanedEquipment? existingLine = null;
            if (item.Id > 0)
            {
                existingLinesById.TryGetValue(item.Id, out existingLine);
            }

            existingLine ??= existingLinesByType.GetValueOrDefault(type);
            if (existingLine is null)
            {
                continue;
            }

            var returnedOnLine = existingLine.Notes
                .Where(n => n.IsReturned)
                .Select(n => (n.Content ?? string.Empty).Trim())
                .Where(c => c.Length > 0)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            if (returnedOnLine.Count == 0)
            {
                continue;
            }

            item.Notes ??= [];
            var notesList = item.Notes.ToList();
            var notesByCode = notesList
                .Select(n => ((n.Content ?? string.Empty).Trim(), n))
                .Where(pair => pair.Item1.Length > 0)
                .GroupBy(pair => pair.Item1, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(g => g.Key, g => g.First().n, StringComparer.OrdinalIgnoreCase);

            foreach (var code in returnedOnLine)
            {
                if (notesByCode.TryGetValue(code, out var note))
                {
                    note.IsReturned = true;
                    note.Content = code;
                    continue;
                }

                var ordinal = notesList.Count == 0 ? 0 : notesList.Max(n => n.Ordinal) + 1;
                var restored = new LoanedEquipmentNoteDto
                {
                    Ordinal = ordinal,
                    Content = code,
                    IsReturned = true
                };
                notesList.Add(restored);
                notesByCode[code] = restored;
            }

            item.Notes = notesList;
            var distinctCodes = notesList
                .Select(n => (n.Content ?? string.Empty).Trim())
                .Where(c => c.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Count();
            item.Quantity = Math.Max(item.Quantity, distinctCodes);
            item.ExpectedNoteCount = Math.Max(item.ExpectedNoteCount, item.Quantity);
        }
    }

    private static Dictionary<LoanedEquipmentType, HashSet<string>> ExtractReturnedSerialCodesByType(Order order)
    {
        var result = new Dictionary<LoanedEquipmentType, HashSet<string>>();
        foreach (var line in order.LoanedEquipments)
        {
            if (line.IsCustomItem || line.LoanedEquipmentType is not LoanedEquipmentType type)
            {
                continue;
            }

            if (!result.TryGetValue(type, out var codes))
            {
                codes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                result[type] = codes;
            }

            foreach (var note in line.Notes)
            {
                if (!note.IsReturned)
                {
                    continue;
                }

                var code = (note.Content ?? string.Empty).Trim();
                if (code.Length > 0)
                {
                    codes.Add(code);
                }
            }
        }

        return result;
    }

    private static HashSet<string> GetReturnedSerialCodes(OrderLoanedEquipment line)
    {
        return (line.Notes ?? [])
            .Where(n => n.IsReturned)
            .Select(n => (n.Content ?? string.Empty).Trim())
            .Where(c => c.Length > 0)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static HashSet<string> GetAssignedSerialCodes(OrderLoanedEquipment line)
    {
        return (line.Notes ?? [])
            .Select(n => (n.Content ?? string.Empty).Trim())
            .Where(c => c.Length > 0)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static List<string> NormalizeReturnedSerialCodes(
        IEnumerable<string>? rawCodes,
        HashSet<string> assignedCodes)
    {
        var result = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var raw in rawCodes ?? [])
        {
            var code = (raw ?? string.Empty).Trim();
            if (code.Length == 0 || !assignedCodes.Contains(code) || !seen.Add(code))
            {
                continue;
            }

            result.Add(code);
        }

        return result;
    }

    private static void ApplyReturnedSerialCodes(
        OrderLoanedEquipment line,
        HashSet<string> assignedCodes,
        IReadOnlyCollection<string> returnedCodes)
    {
        var returned = returnedCodes.ToHashSet(StringComparer.OrdinalIgnoreCase);
        foreach (var note in line.Notes)
        {
            var code = (note.Content ?? string.Empty).Trim();
            note.IsReturned = code.Length > 0
                && assignedCodes.Contains(code)
                && returned.Contains(code);
        }
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

    private void SyncLoanedEquipments(
        Order order,
        IEnumerable<OrderLoanedEquipmentDto> incomingDtos,
        IReadOnlyDictionary<int, int>? priorReturnsById)
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
                ApplyLoanedEquipmentScalars(line, dto);
                ApplyLoanedEquipmentNotesToLine(line, dto);

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

    private static void ApplyLoanedEquipmentScalars(OrderLoanedEquipment line, OrderLoanedEquipmentDto dto)
    {
        if (dto.IsCustomItem)
        {
            line.IsCustomItem = true;
            line.CustomItemName = dto.CustomItemName?.Trim();
            line.LoanedEquipmentType = null;
            line.Quantity = dto.Quantity;
            line.ExpectedNoteCount = 0;
            return;
        }

        line.IsCustomItem = false;
        line.CustomItemName = null;
        line.LoanedEquipmentType = dto.LoanedEquipmentType;
        line.Quantity = dto.Quantity;
        line.ExpectedNoteCount = Math.Max(0, dto.ExpectedNoteCount);
    }

    private static void ApplyLoanedEquipmentNotesToLine(OrderLoanedEquipment line, OrderLoanedEquipmentDto dto)
    {
        if (dto.IsCustomItem)
        {
            line.Notes.Clear();
            return;
        }

        var replacementNotes = BuildLoanedEquipmentNotes(dto);
        line.Notes.Clear();
        foreach (var note in replacementNotes)
        {
            line.Notes.Add(note);
        }
    }

    private static List<LoanedEquipmentNote> BuildLoanedEquipmentNotes(OrderLoanedEquipmentDto dto)
    {
        var expected = Math.Max(0, dto.ExpectedNoteCount);
        var byOrdinal = (dto.Notes ?? [])
            .GroupBy(n => n.Ordinal)
            .ToDictionary(g => g.Key, g => g.First());

        var notes = new List<LoanedEquipmentNote>(expected);
        for (var i = 0; i < expected; i++)
        {
            byOrdinal.TryGetValue(i, out var noteDto);
            notes.Add(new LoanedEquipmentNote
            {
                Ordinal = i,
                Content = string.IsNullOrWhiteSpace(noteDto?.Content) ? null : noteDto.Content.Trim(),
                IsReturned = noteDto?.IsReturned ?? false
            });
        }

        return notes;
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
        bool allowAccessoryOnlyLoan,
        CancellationToken cancellationToken)
    {
        if (equipmentIds.Count == 0)
        {
            if (!allowAccessoryOnlyLoan)
            {
                throw new ValidationException("יש לבחור לפחות ציוד אחד");
            }
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

        if (equipmentIds.Count == 0)
        {
            return;
        }

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
