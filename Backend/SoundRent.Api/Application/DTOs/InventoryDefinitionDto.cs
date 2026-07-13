using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class InventoryDefinitionDto
{
    public int Id { get; set; }

    public string DisplayName { get; set; } = string.Empty;

    public int SortOrder { get; set; }

    public int TotalQuantity { get; set; }

    public List<string> SerialCodes { get; set; } = [];

    /// <summary>When set, this catalog row backs a system loaned-equipment type.</summary>
    public LoanedEquipmentType? LinkedEquipmentType { get; set; }
}

public class InventoryDefinitionCreateDto
{
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>Optional. When null/empty, treated as 0. When &gt; 0, that many serial slots are created.</summary>
    public int? Quantity { get; set; }

    /// <summary>Optional per-unit codes. Blank entries get sequential fallbacks. Extra entries beyond quantity are ignored.</summary>
    public List<string>? SerialCodes { get; set; }
}

public class InventoryDefinitionUpdateDto
{
    public string DisplayName { get; set; } = string.Empty;
}

public class InventoryDefinitionSerialsUpdateDto
{
    public List<string> SerialCodes { get; set; } = [];
}

public class InventoryDefinitionBatchUpdateDto
{
    public List<InventoryDefinitionTypeUpdateDto> Items { get; set; } = [];
}

public class InventoryDefinitionTypeUpdateDto
{
    public int Id { get; set; }

    public List<string> SerialCodes { get; set; } = [];
}
