using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

/// <summary>Master registry of serial/unit codes for a loaned accessory type.</summary>
public class AccessorySerialInventory
{
    public int Id { get; set; }

    public LoanedEquipmentType EquipmentType { get; set; }

    [Required]
    [MaxLength(100)]
    public string SerialCode { get; set; } = string.Empty;
}
