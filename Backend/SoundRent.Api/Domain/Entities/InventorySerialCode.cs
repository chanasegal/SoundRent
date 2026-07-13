using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

/// <summary>Unit / serial code belonging to a standalone <see cref="InventoryDefinition"/>.</summary>
public class InventorySerialCode
{
    public int Id { get; set; }

    public int InventoryDefinitionId { get; set; }

    public InventoryDefinition InventoryDefinition { get; set; } = null!;

    [Required]
    [MaxLength(100)]
    public string SerialCode { get; set; } = string.Empty;

    public AccessorySerialPhysicalStatus PhysicalStatus { get; set; } = AccessorySerialPhysicalStatus.InWarehouse;
}
