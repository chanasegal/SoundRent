using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

public class WaitlistEntry
{
    public int Id { get; set; }

    [MaxLength(100)]
    public string? CustomerName { get; set; }

    [Required]
    [MaxLength(20)]
    public string Phone { get; set; } = string.Empty;

    public EquipmentType EquipmentType { get; set; }

    public DateOnly WaitlistDate { get; set; }

    [MaxLength(1000)]
    public string? Notes { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Which product system this waitlist row belongs to.</summary>
    public SystemType SystemType { get; set; } = SystemType.Sound;
}
