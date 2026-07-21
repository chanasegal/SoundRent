using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class EquipmentDefaultAccessoryDto
{
    public int Id { get; set; }

    public LoanedEquipmentType ParentEquipmentType { get; set; }

    public string ParentSerialCode { get; set; } = string.Empty;

    public string ParentLabel { get; set; } = string.Empty;

    public int? InventoryDefinitionId { get; set; }

    public LoanedEquipmentType? AccessoryEquipmentType { get; set; }

    public string AccessoryLabel { get; set; } = string.Empty;

    public string AccessorySerialCode { get; set; } = string.Empty;
}

public class CreateEquipmentDefaultAccessoryDto
{
    public LoanedEquipmentType ParentEquipmentType { get; set; }

    public string ParentSerialCode { get; set; } = string.Empty;

    /// <summary>Preferred: catalog row id from inventory master table.</summary>
    public int? InventoryDefinitionId { get; set; }

    /// <summary>Legacy: system type when InventoryDefinitionId is omitted.</summary>
    public LoanedEquipmentType? AccessoryEquipmentType { get; set; }

    public string AccessorySerialCode { get; set; } = string.Empty;
}

public class CreateEquipmentDefaultAccessoriesBatchDto
{
    public LoanedEquipmentType ParentEquipmentType { get; set; }

    public string ParentSerialCode { get; set; } = string.Empty;

    /// <summary>Preferred: catalog row id from inventory master table.</summary>
    public int? InventoryDefinitionId { get; set; }

    /// <summary>Legacy: system type when InventoryDefinitionId is omitted.</summary>
    public LoanedEquipmentType? AccessoryEquipmentType { get; set; }

    public List<string> AccessorySerialCodes { get; set; } = [];
}

public class EquipmentDefaultAccessoryCountDto
{
    public LoanedEquipmentType ParentEquipmentType { get; set; }

    public string ParentSerialCode { get; set; } = string.Empty;

    public int Count { get; set; }
}
