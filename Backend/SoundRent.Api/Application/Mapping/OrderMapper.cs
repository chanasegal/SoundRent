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
        DepositType = order.DepositType,
        DepositOnName = order.DepositOnName,
        PaymentAmount = order.PaymentAmount,
        IsPaid = order.IsPaid,
        IsCancelled = order.IsCancelled,
        ReturnTimeType = order.ReturnTimeType,
        CustomReturnTime = order.CustomReturnTime,
        Notes = order.Notes,
        CreatedAt = order.CreatedAt,
        LoanedEquipments = order.LoanedEquipments.Select(ToDto).ToList()
    };

    public static OrderShiftDto ToDto(OrderShift shift) => new()
    {
        OrderDate = shift.OrderDate,
        TimeSlot = shift.TimeSlot
    };

    public static OrderLoanedEquipmentDto ToDto(OrderLoanedEquipment le) => new()
    {
        Id = le.Id,
        LoanedEquipmentType = le.LoanedEquipmentType,
        Quantity = le.Quantity,
        ExpectedNoteCount = le.ExpectedNoteCount,
        Notes = le.Notes
            .OrderBy(n => n.Ordinal)
            .Select(n => new LoanedEquipmentNoteDto
            {
                Id = n.Id,
                Ordinal = n.Ordinal,
                Content = n.Content
            })
            .ToList()
    };

    public static Order ToEntity(OrderCreateUpdateDto dto) => new()
    {
        CustomerName = NullIfBlank(dto.CustomerName),
        Phone = PhoneNumberNormalizer.DigitsOnly(dto.Phone),
        Phone2 = NormalizeOptionalPhone(dto.Phone2),
        Address = NullIfBlank(dto.Address),
        DepositType = dto.DepositType,
        DepositOnName = NullIfBlank(dto.DepositOnName),
        PaymentAmount = dto.PaymentAmount,
        IsPaid = dto.IsPaid,
        ReturnTimeType = dto.ReturnTimeType,
        CustomReturnTime = NormalizeCustomReturnTime(dto),
        Notes = NullIfBlank(dto.Notes),
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
        var expected = Math.Max(0, dto.ExpectedNoteCount);
        var entity = new OrderLoanedEquipment
        {
            LoanedEquipmentType = dto.LoanedEquipmentType,
            Quantity = dto.Quantity,
            ExpectedNoteCount = expected,
            Notes = new List<LoanedEquipmentNote>()
        };

        var byOrdinal = (dto.Notes ?? [])
            .GroupBy(n => n.Ordinal)
            .ToDictionary(g => g.Key, g => g.First());

        for (var i = 0; i < expected; i++)
        {
            byOrdinal.TryGetValue(i, out var noteDto);
            entity.Notes.Add(new LoanedEquipmentNote
            {
                Ordinal = i,
                Content = NullIfBlank(noteDto?.Content)
            });
        }

        return entity;
    }

    public static void ApplyTo(OrderCreateUpdateDto dto, Order entity)
    {
        entity.CustomerName = NullIfBlank(dto.CustomerName);
        entity.Phone = PhoneNumberNormalizer.DigitsOnly(dto.Phone);
        entity.Phone2 = NormalizeOptionalPhone(dto.Phone2);
        entity.Address = NullIfBlank(dto.Address);
        entity.DepositType = dto.DepositType;
        entity.DepositOnName = NullIfBlank(dto.DepositOnName);
        entity.PaymentAmount = dto.PaymentAmount;
        entity.IsPaid = dto.IsPaid;
        entity.ReturnTimeType = dto.ReturnTimeType;
        entity.CustomReturnTime = NormalizeCustomReturnTime(dto);
        entity.Notes = NullIfBlank(dto.Notes);
    }

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
}
