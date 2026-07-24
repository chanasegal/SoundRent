using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class UnreturnedItemDto
{
    /// <summary>When set, this row is a manual entry not linked to an order.</summary>
    public int? ManualItemId { get; set; }

    /// <summary>Catalog row id when the manual entry is tied to inventory.</summary>
    public int? InventoryDefinitionId { get; set; }

    public int OrderId { get; set; }
    public string? CustomerName { get; set; }
    public string Phone { get; set; } = string.Empty;
    public string? Address { get; set; }
    public int LoanedEquipmentId { get; set; }
    public bool IsCustomItem { get; set; }
    public LoanedEquipmentType? LoanedEquipmentType { get; set; }
    public string EquipmentName { get; set; } = string.Empty;
    public DateOnly ReturnDate { get; set; }
    public int QuantityLoaned { get; set; }
    public int MissingQuantity { get; set; }

    /// <summary>Assigned serial codes not yet marked returned on this line.</summary>
    public List<string> MissingSerialCodes { get; set; } = [];

    /// <summary>All serial codes assigned to this line (for full return actions).</summary>
    public List<string> AssignedSerialCodes { get; set; } = [];
}
