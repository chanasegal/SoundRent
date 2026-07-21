using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

/// <summary>
/// Standalone accessory / inventory catalog item (warehouse tracking).
/// Not used as a weekly-board booking column — those live in <see cref="EquipmentDefinition"/>.
/// When <see cref="LinkedEquipmentType"/> is set, unit codes are stored in AccessorySerialInventory
/// so loan / quick-loan flows keep working.
/// </summary>
public class InventoryDefinition
{
    public int Id { get; set; }

    [Required]
    [MaxLength(200)]
    public string DisplayName { get; set; } = string.Empty;

    public int SortOrder { get; set; }

    /// <summary>
    /// Tracked stock quantity. For custom (unlinked) rows this can be set without serial codes.
    /// For linked system types this mirrors the serial-code count.
    /// </summary>
    public int Quantity { get; set; }

    /// <summary>
    /// When set, this row is the editable catalog entry for a system <see cref="LoanedEquipmentType"/>.
    /// </summary>
    public LoanedEquipmentType? LinkedEquipmentType { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<InventorySerialCode> SerialCodes { get; set; } = new List<InventorySerialCode>();
}
