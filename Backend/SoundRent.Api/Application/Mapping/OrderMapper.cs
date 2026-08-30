using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.PhoneNumbers;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.Mapping;

public static class OrderMapper
{
    public static OrderDto ToDto(Order order) => new()
    {
        Id = order.Id,
        EquipmentDefinitionIds = order.Equipments
            .OrderBy(e => e.EquipmentDefinition?.SortOrder ?? int.MaxValue)
            .ThenBy(e => e.EquipmentDefinitionId)
            .Select(e => e.EquipmentDefinitionId)
            .ToList(),
        Shifts = order.Shifts
            .OrderBy(s => s.OrderDate)
            .ThenBy(s => s.TimeSlot)
            .Select(ToDto)
            .ToList(),
        CustomerName = order.CustomerName,
        Phone = order.Phone,
        Phone2 = order.Phone2,
        Address = order.Address,
        InstitutionName = order.Institution?.Name ?? order.InstitutionName,
        InstitutionId = order.InstitutionId,
        DepositType = order.DepositType,
        DepositOnName = order.DepositOnName,
        PaymentAmount = order.PaymentAmount,
        IsUnpaid = order.IsUnpaid,
        IsCancelled = order.IsCancelled,
        IsReturnProcessed = order.IsReturnProcessed,
        ReturnTimeType = order.ReturnTimeType,
        CustomReturnTime = order.CustomReturnTime,
        Notes = order.Notes,
        UrgentBoardNote = order.UrgentBoardNote,
        CreatedAt = order.CreatedAt,
        SystemType = order.SystemType,
        LoanedEquipments = order.LoanedEquipments.Select(ToDto).ToList()
    };

    public static string GetLoanedEquipmentDisplayName(OrderLoanedEquipment le) =>
        ResolveLoanedItemDisplayName(
            le.IsCustomItem,
            le.CustomItemName,
            le.InventoryDefinition?.DisplayName,
            le.LoanedEquipmentType);

    /// <summary>
    /// Catalog rows are keyed by inventory definition id; the legacy enum may be null.
    /// </summary>
    public static string ResolveLoanedItemDisplayName(
        bool isCustomItem,
        string? customItemName,
        string? inventoryDisplayName,
        LoanedEquipmentType? loanedEquipmentType)
    {
        var custom = (customItemName ?? string.Empty).Trim();
        if (isCustomItem)
        {
            return custom.Length > 0 ? custom : "פריט נוסף";
        }

        var fromCatalog = (inventoryDisplayName ?? string.Empty).Trim();
        if (fromCatalog.Length > 0)
        {
            return fromCatalog;
        }

        if (loanedEquipmentType is { } type)
        {
            var label = LoanedEquipmentTypeLabels.GetLabel(type);
            if (!string.IsNullOrWhiteSpace(label))
            {
                return label;
            }
        }

        return custom.Length > 0 ? custom : "פריט";
    }

    public static bool IsPlaceholderItemName(string? name)
    {
        var trimmed = (name ?? string.Empty).Trim();
        return trimmed.Length == 0
            || trimmed == "פריט"
            || trimmed == "פריט נוסף";
    }

    public static OrderShiftDto ToDto(OrderShift shift) => new()
    {
        OrderDate = shift.OrderDate,
        TimeSlot = shift.TimeSlot
    };

    public static OrderLoanedEquipmentDto ToDto(OrderLoanedEquipment le) => new()
    {
        Id = le.Id,
        InventoryDefinitionId = le.InventoryDefinitionId,
        IsCustomItem = le.IsCustomItem,
        LoanedEquipmentType = le.LoanedEquipmentType,
        CustomItemName = le.CustomItemName,
        Quantity = le.Quantity,
        ReturnedQuantity = le.ReturnedQuantity,
        ExpectedNoteCount = le.ExpectedNoteCount,
        Notes = le.Notes
            .OrderBy(n => n.Ordinal)
            .Select(n => new LoanedEquipmentNoteDto
            {
                Id = n.Id,
                Ordinal = n.Ordinal,
                Content = n.Content,
                IsReturned = n.IsReturned
            })
            .ToList()
    };

    public static Order ToEntity(OrderCreateUpdateDto dto) => new()
    {
        CustomerName = NullIfBlank(dto.CustomerName),
        Phone = PhoneNumberNormalizer.DigitsOnly(dto.Phone),
        Phone2 = NormalizeOptionalPhone(dto.Phone2),
        Address = NullIfBlank(dto.Address),
        InstitutionId = dto.InstitutionId,
        InstitutionName = NullIfBlank(dto.InstitutionName),
        DepositType = dto.DepositType,
        DepositOnName = NullIfBlank(dto.DepositOnName),
        PaymentAmount = dto.PaymentAmount,
        IsUnpaid = NormalizeIsUnpaid(dto.PaymentAmount, dto.IsUnpaid),
        ReturnTimeType = dto.ReturnTimeType,
        CustomReturnTime = NormalizeCustomReturnTime(dto),
        Notes = NullIfBlank(dto.Notes),
        SystemType = dto.SystemType,
        Equipments = NormalizeEquipmentDefinitionIds(dto.EquipmentDefinitionIds)
            .Select(ToEntity)
            .ToList(),
        Shifts = NormalizeShifts(dto.Shifts)
            .Select(ToEntity)
            .ToList(),
        LoanedEquipments = dto.LoanedEquipments.Select(ToEntity).ToList()
    };

    public static OrderEquipment ToEntity(string equipmentDefinitionId) => new()
    {
        EquipmentDefinitionId = equipmentDefinitionId
    };

    public static OrderShift ToEntity(OrderShiftDto dto) => new()
    {
        OrderDate = dto.OrderDate,
        TimeSlot = dto.TimeSlot
    };

    public static OrderLoanedEquipment ToEntity(OrderLoanedEquipmentDto dto)
    {
        if (dto.IsCustomItem)
        {
            var customExpected = Math.Max(0, dto.ExpectedNoteCount);
            if (customExpected == 0 && dto.Notes is { Count: > 0 })
            {
                customExpected = dto.Notes.Count;
            }

            var customEntity = new OrderLoanedEquipment
            {
                IsCustomItem = true,
                InventoryDefinitionId = null,
                CustomItemName = NullIfBlank(dto.CustomItemName),
                LoanedEquipmentType = null,
                Quantity = Math.Max(0, dto.Quantity),
                ReturnedQuantity = 0,
                ExpectedNoteCount = customExpected,
                Notes = new List<LoanedEquipmentNote>()
            };

            AddLoanedEquipmentNotesFromDto(customEntity.Notes, dto, customExpected);
            return customEntity;
        }

        var expected = Math.Max(0, dto.ExpectedNoteCount);
        var catalogEntity = new OrderLoanedEquipment
        {
            IsCustomItem = false,
            InventoryDefinitionId = dto.InventoryDefinitionId,
            CustomItemName = NullIfBlank(dto.CustomItemName),
            LoanedEquipmentType = dto.LoanedEquipmentType,
            Quantity = dto.Quantity,
            ReturnedQuantity = 0,
            ExpectedNoteCount = expected,
            Notes = new List<LoanedEquipmentNote>()
        };

        AddLoanedEquipmentNotesFromDto(catalogEntity.Notes, dto, expected);
        return catalogEntity;
    }

    public static void ApplyTo(OrderCreateUpdateDto dto, Order entity)
    {
        entity.CustomerName = NullIfBlank(dto.CustomerName);
        entity.Phone = PhoneNumberNormalizer.DigitsOnly(dto.Phone);
        entity.Phone2 = NormalizeOptionalPhone(dto.Phone2);
        entity.Address = NullIfBlank(dto.Address);
        entity.InstitutionId = dto.InstitutionId;
        entity.InstitutionName = NullIfBlank(dto.InstitutionName);
        entity.DepositType = dto.DepositType;
        entity.DepositOnName = NullIfBlank(dto.DepositOnName);
        entity.PaymentAmount = dto.PaymentAmount;
        entity.IsUnpaid = NormalizeIsUnpaid(dto.PaymentAmount, dto.IsUnpaid);
        entity.ReturnTimeType = dto.ReturnTimeType;
        entity.CustomReturnTime = NormalizeCustomReturnTime(dto);
        entity.Notes = NullIfBlank(dto.Notes);
    }

    /// <summary>
    /// An order is tracked as unpaid debt only when it has a positive payment amount.
    /// </summary>
    public static bool NormalizeIsUnpaid(decimal? paymentAmount, bool isUnpaid) =>
        isUnpaid && paymentAmount is > 0;

    public static IReadOnlyList<string> NormalizeEquipmentDefinitionIds(IEnumerable<string>? ids)
    {
        return (ids ?? [])
            .Select(id => id.Trim())
            .Where(id => id.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static IReadOnlyList<OrderShiftDto> NormalizeShifts(IEnumerable<OrderShiftDto>? shifts)
    {
        return (shifts ?? [])
            .GroupBy(s => new { s.OrderDate, s.TimeSlot })
            .Select(g => g.First())
            .OrderBy(s => s.OrderDate)
            .ThenBy(s => s.TimeSlot)
            .ToList();
    }

    private static string? NormalizeOptionalPhone(string? value)
    {
        var digits = PhoneNumberNormalizer.DigitsOnly(value);
        return digits.Length == 0 ? null : digits;
    }

    /// <summary>
    /// Trims the value and returns <c>null</c> when nothing remains, so optional
    /// text columns store <c>NULL</c> rather than empty strings.
    /// </summary>
    private static string? NullIfBlank(string? value)
    {
        if (value is null)
        {
            return null;
        }
        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }

    private static string? NormalizeCustomReturnTime(OrderCreateUpdateDto dto)
    {
        return dto.ReturnTimeType == ReturnTimeType.SpecificTime
            ? NullIfBlank(dto.CustomReturnTime)
            : null;
    }

    private static void AddLoanedEquipmentNotesFromDto(
        ICollection<LoanedEquipmentNote> target,
        OrderLoanedEquipmentDto dto,
        int expected)
    {
        var byOrdinal = (dto.Notes ?? [])
            .GroupBy(n => n.Ordinal)
            .ToDictionary(g => g.Key, g => g.First());

        for (var i = 0; i < expected; i++)
        {
            byOrdinal.TryGetValue(i, out var noteDto);
            target.Add(new LoanedEquipmentNote
            {
                Ordinal = i,
                Content = NullIfBlank(noteDto?.Content),
                IsReturned = noteDto?.IsReturned ?? false
            });
        }
    }
}
