using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

public class Order
{
    public int Id { get; set; }

    [MaxLength(100)]
    public string? CustomerName { get; set; }

    [Required]
    [MaxLength(20)]
    public string Phone { get; set; } = string.Empty;

    [MaxLength(20)]
    public string? Phone2 { get; set; }

    [MaxLength(200)]
    public string? Address { get; set; }

    /// <summary>Optional institution / venue name used for same-day conflict warnings.</summary>
    [MaxLength(200)]
    public string? InstitutionName { get; set; }

    /// <summary>Optional FK to the managed Institutions directory.</summary>
    public int? InstitutionId { get; set; }

    public Institution? Institution { get; set; }

    public DepositType? DepositType { get; set; }

    [MaxLength(100)]
    public string? DepositOnName { get; set; }

    public decimal? PaymentAmount { get; set; }

    /// <summary>True when the customer still owes payment for this order.</summary>
    public bool IsUnpaid { get; set; }

    public bool IsCancelled { get; set; }

    /// <summary>True after warehouse staff saved a return check-in for this order.</summary>
    public bool IsReturnProcessed { get; set; }

    public ReturnTimeType ReturnTimeType { get; set; } = ReturnTimeType.LateNight;

    [MaxLength(20)]
    public string? CustomReturnTime { get; set; }

    [MaxLength(1000)]
    public string? Notes { get; set; }

    /// <summary>Urgent board-only note shown under return time on the weekly grid.</summary>
    [MaxLength(1000)]
    public string? UrgentBoardNote { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<OrderEquipment> Equipments { get; set; } = new List<OrderEquipment>();

    public ICollection<OrderShift> Shifts { get; set; } = new List<OrderShift>();

    public ICollection<OrderLoanedEquipment> LoanedEquipments { get; set; } = new List<OrderLoanedEquipment>();

    public ICollection<OrderCustomMissingItem> CustomMissingItems { get; set; } = new List<OrderCustomMissingItem>();
}
