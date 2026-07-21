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

    /// <summary>Accessory type bound to the parent unit (e.g. Xlr, PowerCable).</summary>
    public LoanedEquipmentType AccessoryEquipmentType { get; set; }

    [Required]
    [MaxLength(100)]
    public string AccessorySerialCode { get; set; } = string.Empty;
}
