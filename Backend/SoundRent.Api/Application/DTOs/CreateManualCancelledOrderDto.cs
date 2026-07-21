using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Application.Validation;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class CreateManualCancelledOrderDto : IValidatableObject
{
    [MaxLength(100)]
    public string? CustomerName { get; set; }

    [Required]
    [MaxLength(20)]
    public string Phone { get; set; } = string.Empty;

    [MaxLength(200)]
    public string? Address { get; set; }

    [MinLength(1, ErrorMessage = "יש לבחור לפחות ציוד אחד")]
    public List<string> EquipmentDefinitionIds { get; set; } = new();

    [Required]
    public DateOnly StartDate { get; set; }

    [Required]
    public DateOnly EndDate { get; set; }

    [Range(0, double.MaxValue)]
    public decimal? TotalAmount { get; set; }

    public SystemType SystemType { get; set; } = SystemType.Tools;

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (!IsraeliPhoneValidator.TryNormalizeRequired(Phone, out _))
        {
            yield return new ValidationResult(
                IsraeliPhoneValidator.InvalidPhoneMessage,
                new[] { nameof(Phone) });
        }
    }
}
