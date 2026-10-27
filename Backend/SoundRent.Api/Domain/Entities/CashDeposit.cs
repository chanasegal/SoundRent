using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

/// <summary>
/// Central ledger row for a cash deposit held against a loan / order in any workspace.
/// Customer details are copied from the source so search/reports stay valid when the source
/// order is cancelled, soft-deleted, or fully returned. Status (Open / Returned) changes only
/// when staff explicitly mark the deposit returned — never from the order lifecycle.
/// </summary>
public class CashDeposit
{
    public int Id { get; set; }

    [MaxLength(200)]
    public string CustomerName { get; set; } = string.Empty;

    [Required]
    [MaxLength(20)]
    public string Phone { get; set; } = string.Empty;

    [MaxLength(500)]
    public string? Address { get; set; }

    public decimal Amount { get; set; }

    public DateTime ReceivedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Workspace the deposit was taken in (Sound / Tools / Library).</summary>
    public SystemType SourceModule { get; set; } = SystemType.Sound;

    /// <summary>
    /// Source <see cref="Order"/> (Sound bookings and Tools accessory loans).
    /// Real FK — order soft-delete keeps the link; hard delete is blocked while a row exists.
    /// </summary>
    public int? OrderId { get; set; }

    public Order? Order { get; set; }

    /// <summary>Source <see cref="ToolLoan"/>. Not a FK.</summary>
    public int? ToolLoanId { get; set; }

    /// <summary>Source <see cref="BookLoan"/>. Not a FK.</summary>
    public int? BookLoanId { get; set; }

    public CashDepositStatus Status { get; set; } = CashDepositStatus.Open;

    public DateTime? ReturnedAt { get; set; }

    [MaxLength(1000)]
    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
