using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Domain.Entities;

/// <summary>Tools-workspace lending row (isolated from Sound orders).</summary>
public class ToolLoan
{
    public int Id { get; set; }

    public DateTime LentAt { get; set; }

    [MaxLength(120)]
    public string HebrewLentDisplay { get; set; } = string.Empty;

    [MaxLength(200)]
    public string ClientName { get; set; } = string.Empty;

    [Required]
    [MaxLength(20)]
    public string Phone { get; set; } = string.Empty;

    [MaxLength(20)]
    public string? Phone2 { get; set; }

    [MaxLength(500)]
    public string? Address { get; set; }

    [MaxLength(500)]
    public string? Deposit { get; set; }

    [MaxLength(2000)]
    public string? Notes { get; set; }

    /// <summary>When set, the expected return instant (local wall-clock stored as UTC).</summary>
    public DateTime? DeadlineAt { get; set; }

    public DateTime? ReturnedAt { get; set; }

    [MaxLength(120)]
    public string? HebrewReturnedDisplay { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<ToolLoanItem> Items { get; set; } = new List<ToolLoanItem>();
}
