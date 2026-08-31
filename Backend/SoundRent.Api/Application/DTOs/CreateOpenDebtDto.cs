using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Application.Validation;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class CreateOpenDebtDto : IValidatableObject
{
    [MaxLength(200)]
    public string? CustomerName { get; set; }

    [Required]
    [MaxLength(20)]
    public string Phone { get; set; } = string.Empty;

    [MaxLength(300)]
    public string? Address { get; set; }

    public DebtCategory Category { get; set; } = DebtCategory.Amplification;

    [MaxLength(300)]
    public string? ItemDescription { get; set; }

    [MaxLength(500)]
    public string? Deposit { get; set; }

    [MaxLength(2000)]
    public string? Notes { get; set; }

    [Range(0.01, double.MaxValue)]
    public decimal Amount { get; set; }

    /// <summary>Optional charge date (local calendar day). Defaults to UTC today when omitted.</summary>
    public DateOnly? ChargedAt { get; set; }

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
