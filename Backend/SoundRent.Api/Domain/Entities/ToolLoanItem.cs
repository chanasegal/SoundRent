using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Domain.Entities;

/// <summary>One borrowed tool unit on a <see cref="ToolLoan"/>.</summary>
public class ToolLoanItem
{
    public int Id { get; set; }

    public int ToolLoanId { get; set; }

    public ToolLoan ToolLoan { get; set; } = null!;

    public int ToolDefinitionId { get; set; }

    [Required]
    [MaxLength(200)]
    public string ToolName { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    public string SerialCode { get; set; } = string.Empty;

    /// <summary>When this unit was added to the loan (later than <see cref="ToolLoan.LentAt"/> when added on edit).</summary>
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;

    /// <summary>When set, this specific unit has been returned independently of sibling items.</summary>
    public DateTime? ReturnedAt { get; set; }

    [MaxLength(120)]
    public string? HebrewReturnedDisplay { get; set; }

    /// <summary>Charge amount recorded at return (null / 0 = no charge).</summary>
    public decimal? ChargeAmount { get; set; }

    /// <summary>Optional debt created when <see cref="ChargeAmount"/> &gt; 0.</summary>
    public CustomerDebt? CustomerDebt { get; set; }
}
