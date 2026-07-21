using Microsoft.EntityFrameworkCore;
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
    private readonly IInventoryDefinitionService _inventoryDefinitions;
    private readonly ICustomerService _customerService;
    private readonly IBlockedDateRepository _blockedDates;
    private readonly IAccessorySerialInventoryService _accessorySerialInventory;
    private readonly IInstitutionRepository _institutions;

    public OrderService(
        IOrderRepository orderRepository,
        IEquipmentDefinitionRepository equipmentDefinitions,
        IInventoryDefinitionService inventoryDefinitions,
        ICustomerService customerService,
        IBlockedDateRepository blockedDates,
        IAccessorySerialInventoryService accessorySerialInventory,
        IInstitutionRepository institutions)
    {
        _orderRepository = orderRepository;
        _equipmentDefinitions = equipmentDefinitions;
        _inventoryDefinitions = inventoryDefinitions;
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
        SystemType? systemType = null,
        CancellationToken cancellationToken = default)
    {
        if (endDate < startDate)
        {
            throw new ValidationException("תאריך הסיום חייב להיות באותו יום או אחרי תאריך ההתחלה");
        }

        var orders = await _orderRepository.GetByDateRangeAsync(
            startDate,
            endDate,
            systemType,
            cancellationToken);
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
            systemType: dto.SystemType,
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
            systemType: dto.SystemType,
            cancellationToken);

        var priorAssignedSerials = ExtractAssignedSerialCodesByType(existing);

        OrderMapper.ApplyTo(dto, existing);
        existing.SystemType = dto.SystemType;

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
        var systemType = dto.SystemType;

        if (dto.InstitutionId is int institutionId)
        {
            var institution = await _institutions.GetByIdAsync(institutionId, cancellationToken)
                ?? throw new ValidationException("המוסד שנבחר לא נמצא");
            await _institutions.EnsureSystemLinkAsync(institution.Id, systemType, cancellationToken);
            await _institutions.SaveChangesAsync(cancellationToken);
            dto.InstitutionId = institution.Id;
            dto.InstitutionName = institution.Name;
            return;
        }

        if (!string.IsNullOrWhiteSpace(dto.InstitutionName))
        {
            var name = dto.InstitutionName.Trim();
            var match = await _institutions.FindByNameAsync(name, systemType, cancellationToken)
                ?? await _institutions.FindByNameAsync(name, systemType: null, cancellationToken);
            if (match is not null)
            {
                await _institutions.EnsureSystemLinkAsync(match.Id, systemType, cancellationToken);
                await _institutions.SaveChangesAsync(cancellationToken);
                dto.InstitutionId = match.Id;
                dto.InstitutionName = match.Name;
                return;
            }

            // Auto-persist new institution names so they appear in future typeaheads.
            var created = new Institution { Name = name };
            try
            {
                await _institutions.AddAsync(created, cancellationToken);
                await _institutions.SaveChangesAsync(cancellationToken);
                await _institutions.EnsureSystemLinkAsync(created.Id, systemType, cancellationToken);
                await _institutions.SaveChangesAsync(cancellationToken);
                dto.InstitutionId = created.Id;
                dto.InstitutionName = created.Name;
            }
            catch (DbUpdateException)
            {
                // Concurrent create of the same name — link to the row that won.
                var raced = await _institutions.FindByNameAsync(name, systemType: null, cancellationToken)
                    ?? throw new ValidationException("לא ניתן לשמור את שם המוסד");
                await _institutions.EnsureSystemLinkAsync(raced.Id, systemType, cancellationToken);
                await _institutions.SaveChangesAsync(cancellationToken);
                dto.InstitutionId = raced.Id;
                dto.InstitutionName = raced.Name;
            }
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

    public Task<List<ActiveOneTimeAccessoryLoanDto>> GetActiveOneTimeAccessoryLoansAsync(
        CancellationToken cancellationToken = default)
    {
        return _orderRepository.GetActiveOneTimeAccessoryLoansAsync(cancellationToken);
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

    public async Task<OrderDto> CreateManualCancelledOrderAsync(
        CreateManualCancelledOrderDto dto,
        CancellationToken cancellationToken = default)
    {
        if (!IsraeliPhoneValidator.TryNormalizeRequired(dto.Phone, out var phone))
        {
            throw new ValidationException(IsraeliPhoneValidator.InvalidPhoneMessage);
        }

        var equipmentIds = OrderMapper.NormalizeEquipmentDefinitionIds(dto.EquipmentDefinitionIds);
        if (equipmentIds.Count == 0)
        {
            throw new ValidationException("יש לבחור לפחות ציוד אחד");
        }

        foreach (var equipmentId in equipmentIds)
        {
            if (!await _equipmentDefinitions.ExistsAsync(equipmentId, cancellationToken))
            {
                throw new ValidationException($"ציוד '{equipmentId}' לא נמצא");
            }
        }

        if (dto.EndDate < dto.StartDate)
        {
            throw new ValidationException("תאריך הסיום חייב להיות אחרי או שווה לתאריך ההתחלה");
        }

        var shifts = GenerateContinuousShifts(
            dto.StartDate,
            TimeSlot.Morning,
            dto.EndDate,
            dto.EndDate == dto.StartDate ? TimeSlot.Morning : TimeSlot.Evening);

        var entity = new Order
        {
            CustomerName = TrimOrNull(dto.CustomerName),
            Phone = phone,
            Address = TrimOrNull(dto.Address),
            PaymentAmount = dto.TotalAmount,
            IsUnpaid = false,
            IsCancelled = true,
            ReturnTimeType = ReturnTimeType.LateNight,
            SystemType = dto.SystemType,
            Equipments = equipmentIds.Select(OrderMapper.ToEntity).ToList(),
            Shifts = shifts.Select(OrderMapper.ToEntity).ToList()
        };

        await _orderRepository.AddAsync(entity, cancellationToken);
        await _orderRepository.SaveChangesAsync(cancellationToken);

        var syncDto = new OrderCreateUpdateDto
        {
            CustomerName = entity.CustomerName,
            Phone = entity.Phone,
            Address = entity.Address,
            EquipmentDefinitionIds = equipmentIds.ToList(),
            Shifts = shifts,
            PaymentAmount = entity.PaymentAmount,
            IsUnpaid = false,
            SystemType = entity.SystemType
        };
        await _customerService.SyncFromOrderAsync(syncDto, cancellationToken);

        return OrderMapper.ToDto(entity);
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

                var previouslyReturned = GetReturnedSerialCodes(line);

                // Partial returns are additive: newly returned codes merge with codes already marked returned.
                // This keeps sibling codes (e.g. 12) active when only code 13 is returned in this request.
                var mergedReturned = previouslyReturned
                    .Concat(returnedCodes)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                if (mergedReturned.Count > line.Quantity)
                {
                    throw new ValidationException(
                        $"כמות ההחזרה עבור {label} חייבת להיות בין 0 ל-{line.Quantity}");
                }

                ApplyReturnedSerialCodes(line, assignedCodes, mergedReturned);
                line.ReturnedQuantity = mergedReturned.Count;
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

        existing.IsReturnProcessed = !existing.LoanedEquipments.Any(le =>
            le.Quantity > 0 && le.ReturnedQuantity < le.Quantity);
        await _accessorySerialInventory.ReleaseReturnedSerialsAsync(returnedSerials, cancellationToken);
        await _orderRepository.SaveChangesAsync(cancellationToken);
        return OrderMapper.ToDto(existing);
    }

    public async Task<OrderDto> MarkUnreturnedAsync(
        int id,
        MarkUnreturnedRequestDto request,
        CancellationToken cancellationToken = default)
    {
        var items = request.Items ?? [];
        if (items.Count == 0)
        {
            throw new ValidationException("יש לבחור לפחות פריט אחד שלא חזר");
        }

        var existing = await _orderRepository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("ההזמנה לא נמצאה");

        if (existing.IsCancelled)
        {
            throw new ValidationException("לא ניתן לסמן פריטים שלא חזרו בהזמנה מבוטלת");
        }

        var byLineId = existing.LoanedEquipments.ToDictionary(le => le.Id);
        var returnItems = new List<OrderReturnItemDto>();

        foreach (var item in items)
        {
            if (!byLineId.TryGetValue(item.LoanedEquipmentId, out var line))
            {
                throw new ValidationException("פריט מושאל לא נמצא בהזמנה");
            }

            var label = OrderMapper.GetLoanedEquipmentDisplayName(line);
            if (item.MissingQuantity < 1 || item.MissingQuantity > line.Quantity)
            {
                throw new ValidationException(
                    $"כמות שלא חזרה עבור {label} חייבת להיות בין 1 ל-{line.Quantity}");
            }

            var assignedCodes = GetAssignedSerialCodes(line);
            if (assignedCodes.Count > 0)
            {
                var missingCodes = NormalizeReturnedSerialCodes(item.MissingSerialCodes, assignedCodes);
                if (missingCodes.Count == 0)
                {
                    // No explicit codes — take the last N assigned codes as missing.
                    missingCodes = assignedCodes
                        .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
                        .TakeLast(item.MissingQuantity)
                        .ToList();
                }

                if (missingCodes.Count != item.MissingQuantity)
                {
                    throw new ValidationException(
                        $"יש לבחור {item.MissingQuantity} קודי פריט שלא חזרו עבור {label}");
                }

                var missingSet = missingCodes.ToHashSet(StringComparer.OrdinalIgnoreCase);
                var returnedCodes = assignedCodes
                    .Where(c => !missingSet.Contains(c))
                    .ToList();

                returnItems.Add(new OrderReturnItemDto
                {
                    LoanedEquipmentId = line.Id,
                    QuantityReturned = returnedCodes.Count,
                    ReturnedSerialCodes = returnedCodes
                });
                continue;
            }

            returnItems.Add(new OrderReturnItemDto
            {
                LoanedEquipmentId = line.Id,
                QuantityReturned = line.Quantity - item.MissingQuantity
            });
        }

        // Include other lines that already have return state so we don't wipe them,
        // and seed full-return for untouched lines when first processing a return.
        var touchedIds = returnItems.Select(i => i.LoanedEquipmentId).ToHashSet();
        foreach (var line in existing.LoanedEquipments)
        {
            if (touchedIds.Contains(line.Id))
            {
                continue;
            }

            if (!existing.IsReturnProcessed)
            {
                var assigned = GetAssignedSerialCodes(line);
                if (assigned.Count > 0)
                {
                    returnItems.Add(new OrderReturnItemDto
                    {
                        LoanedEquipmentId = line.Id,
                        QuantityReturned = assigned.Count,
                        ReturnedSerialCodes = assigned.ToList()
                    });
                }
                else
                {
                    returnItems.Add(new OrderReturnItemDto
                    {
                        LoanedEquipmentId = line.Id,
                        QuantityReturned = line.Quantity
                    });
                }
            }
            else
            {
                var assigned = GetAssignedSerialCodes(line);
                if (assigned.Count > 0)
                {
                    var alreadyReturned = GetReturnedSerialCodes(line).ToList();
                    returnItems.Add(new OrderReturnItemDto
                    {
                        LoanedEquipmentId = line.Id,
                        QuantityReturned = alreadyReturned.Count,
                        ReturnedSerialCodes = alreadyReturned
                    });
                }
                else
                {
                    returnItems.Add(new OrderReturnItemDto
                    {
                        LoanedEquipmentId = line.Id,
                        QuantityReturned = line.ReturnedQuantity
                    });
                }
            }
        }

        return await RecordReturnAsync(
            id,
            new OrderReturnRequestDto { Items = returnItems },
            cancellationToken);
    }

    public Task<List<UnreturnedItemDto>> GetUnreturnedItemsAsync(CancellationToken cancellationToken = default)
    {
        return _orderRepository.GetUnreturnedItemsAsync(cancellationToken);
    }

    public async Task<UnreturnedItemDto> CreateManualUnreturnedItemAsync(
        CreateManualUnreturnedItemDto dto,
        CancellationToken cancellationToken = default)
    {
        // Ensure custom catalog items exist in inventory before the manual row is saved.
        if (dto.InventoryDefinitionId is not > 0 && !string.IsNullOrWhiteSpace(dto.ItemName))
        {
            var ensured = await _inventoryDefinitions.EnsureByDisplayNameAsync(
                dto.ItemName.Trim(),
                cancellationToken);
            dto.InventoryDefinitionId = ensured.Id;
            dto.ItemName = ensured.DisplayName;
            dto.LoanedEquipmentType ??= ensured.LinkedEquipmentType;
        }

        var created = await _orderRepository.CreateManualUnreturnedItemAsync(dto, cancellationToken);

        if (!string.IsNullOrWhiteSpace(dto.Phone))
        {
            await _customerService.SyncFromWaitlistAsync(
                dto.Phone,
                dto.CustomerName,
                dto.Address,
                SystemType.Sound,
                cancellationToken);
        }

        var code = (dto.ItemCode ?? string.Empty).Trim();
        if (code.Length > 0)
        {
            if (dto.LoanedEquipmentType is LoanedEquipmentType linked)
            {
                await _accessorySerialInventory.SetPhysicalStatusAsync(
                    linked,
                    code,
                    AccessorySerialPhysicalStatus.Missing,
                    cancellationToken);
            }
            else if (dto.InventoryDefinitionId is > 0)
            {
                await _inventoryDefinitions.MarkSerialMissingAsync(
                    dto.InventoryDefinitionId.Value,
                    code,
                    cancellationToken);
            }
        }

        return created;
    }

    public async Task ResolveManualUnreturnedItemAsync(int manualItemId, CancellationToken cancellationToken = default)
    {
        var items = await _orderRepository.GetUnreturnedItemsAsync(cancellationToken);
        var match = items.FirstOrDefault(i => i.ManualItemId == manualItemId);

        await _orderRepository.ResolveManualUnreturnedItemAsync(manualItemId, cancellationToken);

        if (match is null)
        {
            return;
        }

        var code = (match.MissingSerialCodes?.FirstOrDefault()
                    ?? match.AssignedSerialCodes?.FirstOrDefault()
                    ?? string.Empty).Trim();
        if (code.Length == 0)
        {
            return;
        }

        if (match.LoanedEquipmentType is LoanedEquipmentType linked)
        {
            await _accessorySerialInventory.SetPhysicalStatusAsync(
                linked,
                code,
                AccessorySerialPhysicalStatus.InWarehouse,
                cancellationToken);
            return;
        }

        if (match.InventoryDefinitionId is > 0)
        {
            await _inventoryDefinitions.RestoreSerialAsync(
                match.InventoryDefinitionId.Value,
                code,
                cancellationToken);
        }
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

            if (line is null && dto.IsCustomItem && !string.IsNullOrWhiteSpace(dto.CustomItemName))
            {
                var customName = dto.CustomItemName.Trim();
                line = order.LoanedEquipments.FirstOrDefault(l =>
                    l.IsCustomItem
                    && string.Equals(l.CustomItemName?.Trim(), customName, StringComparison.OrdinalIgnoreCase));
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
            line.ExpectedNoteCount = Math.Max(0, dto.ExpectedNoteCount);
            if (line.ExpectedNoteCount == 0 && dto.Notes is { Count: > 0 })
            {
                line.ExpectedNoteCount = dto.Notes.Count;
            }

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
        if (expected == 0 && dto.Notes is { Count: > 0 })
        {
            expected = dto.Notes.Count;
        }

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
        SystemType systemType,
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

        await ValidateShiftsNotBlockedAsync(shifts, validateBlockedDates, systemType, cancellationToken);

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

            if (def.SystemType != systemType)
            {
                throw new ValidationException("לא ניתן לשריין ציוד ממערכת אחרת");
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
        SystemType systemType,
        CancellationToken cancellationToken)
    {
        if (!validateBlockedDates)
        {
            return;
        }

        var uniqueDates = shifts.Select(s => s.OrderDate).Distinct().ToList();
        foreach (var date in uniqueDates)
        {
            if (await _blockedDates.AnyBlockCoversDateAsync(date, systemType, cancellationToken))
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

    private static string? TrimOrNull(string? value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }
}
