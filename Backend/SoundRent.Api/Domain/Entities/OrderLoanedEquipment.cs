using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

public class OrderLoanedEquipment
{
    public int Id { get; set; }

    public int OrderId { get; set; }
    public Order Order { get; set; } = null!;

    /// <summary>True one-time / free-text accessory (not in permanent catalog).</summary>
    public bool IsCustomItem { get; set; }

    /// <summary>Permanent catalog row when this line references warehouse inventory.</summary>
    public int? InventoryDefinitionId { get; set; }

    public InventoryDefinition? InventoryDefinition { get; set; }

    /// <summary>Legacy enum link — retained for historical rows; prefer <see cref="InventoryDefinitionId"/>.</summary>
    public LoanedEquipmentType? LoanedEquipmentType { get; set; }

    [MaxLength(200)]
    public string? CustomItemName { get; set; }

    public int Quantity { get; set; }

    /// <summary>How many units have been checked back in.</summary>
    public int ReturnedQuantity { get; set; }

    /// <summary>How many detail note inputs apply to this line (UI + persisted notes).</summary>
    public int ExpectedNoteCount { get; set; }

    public ICollection<LoanedEquipmentNote> Notes { get; set; } = new List<LoanedEquipmentNote>();
}
