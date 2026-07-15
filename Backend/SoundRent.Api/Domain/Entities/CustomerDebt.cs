using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

/// <summary>
/// A billable charge linked to a return / order. Used for tool return fees and
/// unified open-debts reporting (alongside unpaid Orders).
/// </summary>
public class CustomerDebt
{
    public int Id { get; set; }

    [MaxLength(200)]
    public string CustomerName { get; set; } = string.Empty;

    [Required]
    [MaxLength(20)]
    public string Phone { get; set; } = string.Empty;

    public decimal Amount { get; set; }

    public bool IsPaid { get; set; }

    public DebtCategory Category { get; set; } = DebtCategory.Tools;

    /// <summary>Display label for the charged item (e.g. tool name).</summary>
    [MaxLength(300)]
    public string ItemDescription { get; set; } = string.Empty;

    public DateTime ChargedAt { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Groups same-day charges for one customer+category (phoneDigits|yyyy-MM-dd|category).
    /// </summary>
    [MaxLength(80)]
    public string SessionKey { get; set; } = string.Empty;

    public int? ToolLoanItemId { get; set; }

    public ToolLoanItem? ToolLoanItem { get; set; }

    public int? BookLoanItemId { get; set; }

    public BookLoanItem? BookLoanItem { get; set; }

    public int? SourceOrderId { get; set; }
}
