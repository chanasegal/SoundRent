using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Application.Validation;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class CreateManualUnreturnedItemDto : IValidatableObject
{
    [MaxLength(200)]
    public string? CustomerName { get; set; }

    [MaxLength(20)]
    public string? Phone { get; set; }

    [MaxLength(200)]
    public string? Address { get; set; }

    [Range(1, int.MaxValue)]
    public int? InventoryDefinitionId { get; set; }

    public LoanedEquipmentType? LoanedEquipmentType { get; set; }

    [MaxLength(200)]
    public string? ItemName { get; set; }

    [MaxLength(100)]
    public string? ItemCode { get; set; }

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (!IsraeliPhoneValidator.TryNormalizeOptional(Phone, out _))
        {
            yield return new ValidationResult(
                IsraeliPhoneValidator.InvalidPhoneMessage,
                new[] { nameof(Phone) });
        }

        var hasCatalogItem = InventoryDefinitionId is > 0;
        var hasCustomName = !string.IsNullOrWhiteSpace(ItemName);
        if (!hasCatalogItem && !hasCustomName)
        {
            yield return new ValidationResult(
                "יש לבחור פריט מהרשימה או להזין תיאור פריט מותאם",
                new[] { nameof(InventoryDefinitionId), nameof(ItemName) });
        }
    }
}
