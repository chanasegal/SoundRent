using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

/// <summary>
/// Permanent accessory / inventory catalog item (warehouse tracking).
/// Not used as a weekly-board booking column — those live in <see cref="EquipmentDefinition"/>.
/// Physical units are stored in <see cref="SerialCodes"/>.
/// </summary>
public class InventoryDefinition
{
    public int Id { get; set; }

    [Required]
    [MaxLength(200)]
    public string DisplayName { get; set; } = string.Empty;

    public int SortOrder { get; set; }

    /// <summary>Tracked stock quantity — mirrors serial-code count when serials are assigned.</summary>
    public int Quantity { get; set; }

    /// <summary>Soft-delete flag for catalog rows removed from active inventory.</summary>
    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<InventorySerialCode> SerialCodes { get; set; } = new List<InventorySerialCode>();
}
