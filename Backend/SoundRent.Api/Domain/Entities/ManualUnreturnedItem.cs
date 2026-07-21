using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

/// <summary>
/// Manually logged missing / unreturned accessory (פריט שלא חזר), not tied to an order.
/// </summary>
public class ManualUnreturnedItem
{
    public int Id { get; set; }

    public int? InventoryDefinitionId { get; set; }

    public InventoryDefinition? InventoryDefinition { get; set; }

    public LoanedEquipmentType? LoanedEquipmentType { get; set; }

    [Required]
    [MaxLength(200)]
    public string ItemName { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    public string ItemCode { get; set; } = string.Empty;

    public bool IsResolved { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
