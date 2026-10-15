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

    /// <summary>Required (&gt; 0) when <see cref="DepositType"/> is Cash; ignored otherwise.</summary>
    public decimal? CashDepositAmount { get; set; }

    public decimal? PaymentAmount { get; set; }

    /// <summary>Paid in advance. Ignored when <see cref="IsUnpaid"/> is set.</summary>
    public bool IsPaid { get; set; }

    /// <summary>Recorded as an open debt (appears in the debts report).</summary>
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

        // "Cash requires an amount" needs the stored order (legacy cash orders have none), so
        // OrderService enforces it via CashDepositService.EnsureOrderCashDepositAmount.
        if (CashDepositAmount is < 0)
        {
            yield return new ValidationResult(
                Services.CashDepositService.AmountInvalidMessage,
                new[] { nameof(CashDepositAmount) });
        }

        // Accessory-only loans are not bound to shift return-time rules.
        if (!hasEquipment && hasLoanedAccessories)
        {
            yield break;
        }

        var lastShift = Shifts
            .OrderBy(s => s.OrderDate)
            .ThenBy(s => s.TimeSlot)
            .LastOrDefault();
        var endsMorning = lastShift is not null && lastShift.TimeSlot == TimeSlot.Morning;
        var endsFridayMorning =
            endsMorning
            && lastShift!.OrderDate.DayOfWeek == DayOfWeek.Friday;

        // Friday morning end: night / next-morning options are invalid (no evening shift).
        // Any morning end may omit the clock (= open morning / end of morning shift).
        if (endsFridayMorning
            && ReturnTimeType is ReturnTimeType.LateNight or ReturnTimeType.NextMorning)
        {
            yield return new ValidationResult(
                "ביום שישי ניתן לבחור רק החזרה מסוג \"עד\"",
                new[] { nameof(ReturnTimeType) });
        }
        else if (ReturnTimeType == ReturnTimeType.SpecificTime
                 && string.IsNullOrWhiteSpace(CustomReturnTime)
                 && !endsMorning)
        {
            yield return new ValidationResult(
                "יש להזין שעת החזרה",
                new[] { nameof(CustomReturnTime) });
        }
    }
}
