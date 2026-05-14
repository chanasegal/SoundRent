using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Application.Mapping;

public static class OrderMapper
{
    public static OrderDto ToDto(Order order) => new()
    {
        Id = order.Id,
        EquipmentType = order.EquipmentType,
        OrderDate = order.OrderDate,
        TimeSlot = order.TimeSlot,
        CustomerName = order.CustomerName,
        Phone = order.Phone,
        Phone2 = order.Phone2,
        Address = order.Address,
        DepositType = order.DepositType,
        DepositOnName = order.DepositOnName,
        PaymentAmount = order.PaymentAmount,
        IsPaid = order.IsPaid,
        Notes = order.Notes,
        CreatedAt = order.CreatedAt,
        LoanedEquipments = order.LoanedEquipments.Select(ToDto).ToList()
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
        EquipmentType = dto.EquipmentType.Trim(),
        OrderDate = dto.OrderDate,
        TimeSlot = dto.TimeSlot,
        CustomerName = NullIfBlank(dto.CustomerName),
        Phone = dto.Phone.Trim(),
        Phone2 = NullIfBlank(dto.Phone2),
        Address = NullIfBlank(dto.Address),
        DepositType = dto.DepositType,
        DepositOnName = NullIfBlank(dto.DepositOnName),
        PaymentAmount = dto.PaymentAmount,
        IsPaid = dto.IsPaid,
        Notes = NullIfBlank(dto.Notes),
        LoanedEquipments = dto.LoanedEquipments.Select(ToEntity).ToList()
    };

    public static OrderLoanedEquipment ToEntity(OrderLoanedEquipmentDto dto)
    {
        var expected = Math.Clamp(dto.ExpectedNoteCount, 0, 20);
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
        entity.EquipmentType = dto.EquipmentType.Trim();
        entity.OrderDate = dto.OrderDate;
        entity.TimeSlot = dto.TimeSlot;
        entity.CustomerName = NullIfBlank(dto.CustomerName);
        entity.Phone = dto.Phone.Trim();
        entity.Phone2 = NullIfBlank(dto.Phone2);
        entity.Address = NullIfBlank(dto.Address);
        entity.DepositType = dto.DepositType;
        entity.DepositOnName = NullIfBlank(dto.DepositOnName);
        entity.PaymentAmount = dto.PaymentAmount;
        entity.IsPaid = dto.IsPaid;
        entity.Notes = NullIfBlank(dto.Notes);
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
}
