using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class OrderDto
{
    public int Id { get; set; }

    /// <summary>Booking slot (e.g. 715-A).</summary>
    public string EquipmentType { get; set; } = string.Empty;
    public DateOnly OrderDate { get; set; }
    public TimeSlot TimeSlot { get; set; }
    public string? CustomerName { get; set; }
    public string Phone { get; set; } = string.Empty;
    public string? Phone2 { get; set; }
    public string? Address { get; set; }
    public DepositType? DepositType { get; set; }
    public string? DepositOnName { get; set; }
    public decimal? PaymentAmount { get; set; }
    public bool IsPaid { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }

    public List<OrderLoanedEquipmentDto> LoanedEquipments { get; set; } = new();
}
