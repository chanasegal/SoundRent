using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

/// <summary>
/// Manually logged missing / unreturned accessory (פריט שלא חזר).
/// Optionally linked to an order when reported from the order form.
/// </summary>
public class ManualUnreturnedItem
{
    public int Id { get; set; }

    /// <summary>Optional source order when reported from an order context.</summary>
    public int? OrderId { get; set; }

    public Order? Order { get; set; }

    public int? InventoryDefinitionId { get; set; }

    public InventoryDefinition? InventoryDefinition { get; set; }

    public LoanedEquipmentType? LoanedEquipmentType { get; set; }

    [MaxLength(200)]
    public string? CustomerName { get; set; }

    [MaxLength(20)]
    public string? Phone { get; set; }

    [MaxLength(200)]
    public string? Address { get; set; }

    [Required]
    [MaxLength(200)]
    public string ItemName { get; set; } = string.Empty;

    [MaxLength(100)]
    public string? ItemCode { get; set; }

    public bool IsResolved { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
