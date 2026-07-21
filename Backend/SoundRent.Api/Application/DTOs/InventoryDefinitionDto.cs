using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class InventoryDefinitionDto
{
    public int Id { get; set; }

    public string DisplayName { get; set; } = string.Empty;

    public int SortOrder { get; set; }

    public int TotalQuantity { get; set; }

    public List<string> SerialCodes { get; set; } = [];

    /// <summary>Per-unit status and holder details (aligned with <see cref="SerialCodes"/>).</summary>
    public List<InventorySerialUnitDto> SerialUnits { get; set; } = [];

    /// <summary>Aggregated row status: Available, LoanedOut, or Missing.</summary>
    public AccessorySerialPhysicalStatus AggregateStatus { get; set; } =
        AccessorySerialPhysicalStatus.InWarehouse;

    public string AggregateStatusLabel { get; set; } = "זמין";

    /// <summary>Active loan / missing holders for this catalog row.</summary>
    public List<InventoryHolderDto> ActiveHolders { get; set; } = [];

    /// <summary>When set, this catalog row backs a system loaned-equipment type.</summary>
    public LoanedEquipmentType? LinkedEquipmentType { get; set; }
}

public class InventorySerialUnitDto
{
    public string SerialCode { get; set; } = string.Empty;

    public AccessorySerialPhysicalStatus PhysicalStatus { get; set; } =
        AccessorySerialPhysicalStatus.InWarehouse;

    /// <summary>Hebrew UI label for <see cref="PhysicalStatus"/>.</summary>
    public string StatusLabel { get; set; } = "במלאי";

    public string? HolderCustomerName { get; set; }

    public string? HolderPhone { get; set; }

    public string? HolderAddress { get; set; }

    /// <summary>Date the unit was marked missing / loaned (yyyy-MM-dd).</summary>
    public DateOnly? MarkedMissingAt { get; set; }
}

public class InventoryHolderDto
{
    public string? SerialCode { get; set; }

    public AccessorySerialPhysicalStatus Status { get; set; } =
        AccessorySerialPhysicalStatus.LoanedOut;

    public string StatusLabel { get; set; } = "בהשאלה";

    public string? CustomerName { get; set; }

    public string? Phone { get; set; }

    public string? Address { get; set; }

    public DateOnly? EventDate { get; set; }

    public int? OrderId { get; set; }
}

public class InventoryDefinitionEnsureDto
{
    public string DisplayName { get; set; } = string.Empty;
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

    /// <summary>Optional stock quantity for custom (unlinked) catalog rows.</summary>
    public int? Quantity { get; set; }

    public List<string> SerialCodes { get; set; } = [];
}
