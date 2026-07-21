using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class CreateManualUnreturnedItemDto
{
    [Range(1, int.MaxValue)]
    public int? InventoryDefinitionId { get; set; }

    public LoanedEquipmentType? LoanedEquipmentType { get; set; }

    [MaxLength(200)]
    public string? ItemName { get; set; }

    [Required]
    [MaxLength(100)]
    public string ItemCode { get; set; } = string.Empty;
}
