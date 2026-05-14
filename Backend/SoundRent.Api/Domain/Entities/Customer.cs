using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Domain.Entities;

/// <summary>Customer directory keyed by normalized primary phone (digits only).</summary>
public class Customer
{
    [Key]
    [MaxLength(20)]
    public string Phone1 { get; set; } = string.Empty;

    [MaxLength(20)]
    public string? Phone2 { get; set; }

    [MaxLength(200)]
    public string? FullName { get; set; }

    [MaxLength(500)]
    public string? Address { get; set; }

    [MaxLength(4000)]
    public string? Notes { get; set; }

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
