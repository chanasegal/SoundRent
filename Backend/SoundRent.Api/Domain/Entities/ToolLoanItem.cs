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

    /// <summary>When set, this specific unit has been returned independently of sibling items.</summary>
    public DateTime? ReturnedAt { get; set; }

    [MaxLength(120)]
    public string? HebrewReturnedDisplay { get; set; }
}
