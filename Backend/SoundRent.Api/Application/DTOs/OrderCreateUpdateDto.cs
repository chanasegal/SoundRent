using System.Collections.Generic;
using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Application.Validation;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class OrderCreateUpdateDto : IValidatableObject
{
    public List<string> EquipmentDefinitionIds { get; set; } = new();

    [MinLength(1, ErrorMessage = "יש לבחור לפחות מועד אחד")]
    public List<OrderShiftDto> Shifts { get; set; } = new();

    [MaxLength(100, ErrorMessage = "שם הלקוח לא יכול לחרוג מ-100 תווים")]
    public string? CustomerName { get; set; }

    [Required(ErrorMessage = "יש להזין מספר טלפון")]
    [MaxLength(20, ErrorMessage = "מספר הטלפון לא יכול לחרוג מ-20 תווים")]
    public string Phone { get; set; } = string.Empty;

    [MaxLength(20, ErrorMessage = "מספר הטלפון לא יכול לחרוג מ-20 תווים")]
    public string? Phone2 { get; set; }

    [MaxLength(200, ErrorMessage = "הכתובת לא יכולה לחרוג מ-200 תווים")]
    public string? Address { get; set; }

    [MaxLength(200, ErrorMessage = "שם המוסד לא יכול לחרוג מ-200 תווים")]
    public string? InstitutionName { get; set; }

    public int? InstitutionId { get; set; }

    public DepositType? DepositType { get; set; }

    [MaxLength(100, ErrorMessage = "שם הפיקדון לא יכול לחרוג מ-100 תווים")]
    public string? DepositOnName { get; set; }

    public decimal? PaymentAmount { get; set; }

    public bool IsUnpaid { get; set; }

    public ReturnTimeType ReturnTimeType { get; set; } = ReturnTimeType.LateNight;

    [MaxLength(20, ErrorMessage = "שעת ההחזרה לא יכולה לחרוג מ-20 תווים")]
    public string? CustomReturnTime { get; set; }

    [MaxLength(1000, ErrorMessage = "ההערות לא יכולות לחרוג מ-1000 תווים")]
    public string? Notes { get; set; }

    public List<OrderLoanedEquipmentDto> LoanedEquipments { get; set; } = new();

    /// <summary>Legacy client field; double-booking is blocked by server validation.</summary>
    public bool AllowDoubleBooking { get; set; }

    /// <summary>Product system context; defaults to Sound when omitted by older clients.</summary>
    public SystemType SystemType { get; set; } = SystemType.Tools;

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        var hasEquipment = EquipmentDefinitionIds.Any(id => !string.IsNullOrWhiteSpace(id));
        var hasLoanedAccessories = LoanedEquipments.Any(le => le.Quantity > 0);
        if (!hasEquipment && !hasLoanedAccessories)
        {
            yield return new ValidationResult(
                "יש לבחור לפחות ציוד אחד",
                new[] { nameof(EquipmentDefinitionIds) });
        }

        if (!IsraeliPhoneValidator.TryNormalizeRequired(Phone, out _))
        {
            yield return new ValidationResult(
                IsraeliPhoneValidator.InvalidPhoneMessage,
                new[] { nameof(Phone) });
        }

        if (!IsraeliPhoneValidator.TryNormalizeOptional(Phone2, out _))
        {
            yield return new ValidationResult(
                IsraeliPhoneValidator.InvalidPhoneMessage,
                new[] { nameof(Phone2) });
        }

        if (ReturnTimeType == ReturnTimeType.SpecificTime && string.IsNullOrWhiteSpace(CustomReturnTime))
        {
            yield return new ValidationResult(
                "יש להזין שעת החזרה",
                new[] { nameof(CustomReturnTime) });
        }
    }
}
