using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class OrderDto
{
    public int Id { get; set; }

    /// <summary>Booking-slot ids, e.g. 715-A / 910NX-B.</summary>
    public List<string> EquipmentDefinitionIds { get; set; } = new();

    /// <summary>Requested date/shift slots reserved by this order.</summary>
    public List<OrderShiftDto> Shifts { get; set; } = new();

    public string? CustomerName { get; set; }
    public string Phone { get; set; } = string.Empty;
    public string? Phone2 { get; set; }
    public string? Address { get; set; }
    public DepositType? DepositType { get; set; }
    public string? DepositOnName { get; set; }
    public decimal? PaymentAmount { get; set; }
    public bool IsUnpaid { get; set; }

    public bool IsCancelled { get; set; }
    public ReturnTimeType ReturnTimeType { get; set; }
    public string? CustomReturnTime { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }

    public List<OrderLoanedEquipmentDto> LoanedEquipments { get; set; } = new();
}
