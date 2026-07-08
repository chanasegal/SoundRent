using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

/// <summary>Lost-and-found equipment log (ציוד שנשכח).</summary>
public class LostEquipment
{
    public int Id { get; set; }

    [Required]
    [MaxLength(200)]
    public string CustomerName { get; set; } = string.Empty;

    [MaxLength(20)]
    public string? Phone { get; set; }

    [Required]
    [MaxLength(500)]
    public string ItemDescription { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    public string HebrewDate { get; set; } = string.Empty;

    [MaxLength(2000)]
    public string? Notes { get; set; }

    public LostEquipmentStatus Status { get; set; } = LostEquipmentStatus.Pending;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
