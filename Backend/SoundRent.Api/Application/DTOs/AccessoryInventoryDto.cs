using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class AccessoryInventoryGroupDto
{
    public LoanedEquipmentType EquipmentType { get; set; }

    public string Label { get; set; } = string.Empty;

    public int TotalQuantity { get; set; }

    public List<string> SerialCodes { get; set; } = [];
}

public class AccessoryInventoryUpdateDto
{
    public List<string> SerialCodes { get; set; } = [];
}

public class AccessoryInventoryBatchUpdateDto
{
    public List<AccessoryInventoryTypeUpdateDto> Items { get; set; } = [];
}

public class AccessoryInventoryTypeUpdateDto
{
    public LoanedEquipmentType EquipmentType { get; set; }

    public List<string> SerialCodes { get; set; } = [];
}

public class AccessorySerialAvailabilityRequestDto
{
    public List<string> Dates { get; set; } = [];

    /// <summary>When set, only orders overlapping these date+shift pairs are treated as booking conflicts.</summary>
    public List<OrderShiftDto>? Shifts { get; set; }

    public int? ExcludeOrderId { get; set; }
}

public class AccessorySerialOptionDto
{
    public string SerialCode { get; set; } = string.Empty;

    public bool IsAvailable { get; set; }
}

public class AccessorySerialAvailabilityGroupDto
{
    public LoanedEquipmentType EquipmentType { get; set; }

    public List<AccessorySerialOptionDto> Options { get; set; } = [];
}
