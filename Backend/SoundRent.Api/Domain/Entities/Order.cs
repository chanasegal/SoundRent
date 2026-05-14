using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

public class Order
{
    public int Id { get; set; }

    /// <summary>
    /// Booking slot key (e.g. <c>715-A</c>, <c>910NX-B</c>) matching the weekly grid columns.
    /// </summary>
    [Required]
    [MaxLength(64)]
    public string EquipmentType { get; set; } = string.Empty;

    public DateOnly OrderDate { get; set; }

    public TimeSlot TimeSlot { get; set; }

    [MaxLength(100)]
    public string? CustomerName { get; set; }

    [Required]
    [MaxLength(20)]
    public string Phone { get; set; } = string.Empty;

    [MaxLength(20)]
    public string? Phone2 { get; set; }

    [MaxLength(200)]
    public string? Address { get; set; }

    public DepositType? DepositType { get; set; }

    [MaxLength(100)]
    public string? DepositOnName { get; set; }

    public decimal? PaymentAmount { get; set; }

    public bool IsPaid { get; set; }

    [MaxLength(1000)]
    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<OrderLoanedEquipment> LoanedEquipments { get; set; } = new List<OrderLoanedEquipment>();
}
