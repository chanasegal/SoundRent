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

    /// <summary>Cash held as deposit; only meaningful when <see cref="DepositType"/> is Cash.</summary>
    public decimal? CashDepositAmount { get; set; }

    /// <summary>True when the cash deposit was handed back to the customer.</summary>
    public bool DepositReturned { get; set; }

    public decimal? PaymentAmount { get; set; }

    /// <summary>True when the customer paid in advance. Mutually exclusive with <see cref="IsUnpaid"/>.</summary>
    public bool IsPaid { get; set; }

    /// <summary>
    /// True when the order is recorded as an open debt (shown in the debts report).
    /// When both flags are false the payment is still pending on an active loan and is not a debt.
    /// </summary>
    public bool IsUnpaid { get; set; }

    public bool IsCancelled { get; set; }

    /// <summary>
    /// Soft-delete flag. Deleted orders stay in the database so cash-deposit FKs remain valid;
    /// deposit active/returned status is independent of this flag.
    /// </summary>
    public bool IsDeleted { get; set; }

    /// <summary>UTC timestamp when <see cref="IsDeleted"/> was set.</summary>
    public DateTime? DeletedAt { get; set; }

    /// <summary>True after warehouse staff saved a return check-in for this order.</summary>
    public bool IsReturnProcessed { get; set; }

    /// <summary>Cash-deposit ledger rows issued against this order (status is independent of order lifecycle).</summary>
    public ICollection<CashDeposit> CashDeposits { get; set; } = new List<CashDeposit>();

    public ReturnTimeType ReturnTimeType { get; set; } = ReturnTimeType.LateNight;

    [MaxLength(20)]
    public string? CustomReturnTime { get; set; }

    [MaxLength(1000)]
    public string? Notes { get; set; }

    /// <summary>Urgent board-only note shown under return time on the weekly grid.</summary>
    [MaxLength(1000)]
    public string? UrgentBoardNote { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Which product system this order belongs to (Sound / Tools / Library).</summary>
    public SystemType SystemType { get; set; } = SystemType.Sound;

    public ICollection<OrderEquipment> Equipments { get; set; } = new List<OrderEquipment>();

    public ICollection<OrderShift> Shifts { get; set; } = new List<OrderShift>();

    public ICollection<OrderLoanedEquipment> LoanedEquipments { get; set; } = new List<OrderLoanedEquipment>();

    public ICollection<OrderCustomMissingItem> CustomMissingItems { get; set; } = new List<OrderCustomMissingItem>();
}
