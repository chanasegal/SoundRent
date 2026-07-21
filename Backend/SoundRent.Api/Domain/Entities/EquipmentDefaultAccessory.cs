using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

/// <summary>
/// Maps a specific primary equipment unit (e.g. Mixer serial "10") to a default
/// accessory serial that should be auto-attached when that unit is selected on an order.
/// </summary>
public class EquipmentDefaultAccessory
{
    public int Id { get; set; }

    /// <summary>Primary equipment type that owns the default kit (e.g. Mixer).</summary>
    public LoanedEquipmentType ParentEquipmentType { get; set; }

    /// <summary>Specific unit/serial code of the parent (e.g. "10").</summary>
    [Required]
    [MaxLength(100)]
    public string ParentSerialCode { get; set; } = string.Empty;

    /// <summary>
    /// Inventory catalog row for the accessory (system-linked or custom).
    /// Preferred key for UI selection from the master inventory table.
    /// </summary>
    public int? InventoryDefinitionId { get; set; }

    /// <summary>
    /// System accessory type when the catalog row is linked; null for custom inventory items.
    /// </summary>
    public LoanedEquipmentType? AccessoryEquipmentType { get; set; }

    [Required]
    [MaxLength(100)]
    public string AccessorySerialCode { get; set; } = string.Empty;

    public InventoryDefinition? InventoryDefinition { get; set; }
}
