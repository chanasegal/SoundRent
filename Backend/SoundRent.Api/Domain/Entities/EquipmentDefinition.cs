using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Domain.Entities;

/// <summary>
/// Admin-configurable booking slot shown on the weekly grid and order form (Id matches Order.EquipmentType).
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
}
