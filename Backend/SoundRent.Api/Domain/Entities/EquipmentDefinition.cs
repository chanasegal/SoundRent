using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

/// <summary>
/// Admin-configurable booking slot shown on the weekly grid and order form.
/// </summary>
public class EquipmentDefinition
{
    [Key]
    [MaxLength(64)]
    public string Id { get; set; } = string.Empty;

    [Required]
    [MaxLength(200)]
    public string DisplayName { get; set; } = string.Empty;

    [Required]
    [MaxLength(80)]
    public string Category { get; set; } = string.Empty;

    public int SortOrder { get; set; }

    /// <summary>When true, this booking slot cannot accept new orders (per-unit maintenance).</summary>
    public bool IsMaintenanceMode { get; set; }

    /// <summary>Which product system this booking slot belongs to.</summary>
    public SystemType SystemType { get; set; } = SystemType.Sound;

    public ICollection<OrderEquipment> Orders { get; set; } = new List<OrderEquipment>();
}
