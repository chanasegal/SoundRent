using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class OrderCreateUpdateDto
{
    [Required(ErrorMessage = "יש לבחור סוג ציוד")]
    [MaxLength(64, ErrorMessage = "ערך ציוד לא תקין")]
    public string EquipmentType { get; set; } = string.Empty;

    [Required(ErrorMessage = "יש להזין תאריך הזמנה")]
    public DateOnly OrderDate { get; set; }

    [Required(ErrorMessage = "יש לבחור משמרת")]
    public TimeSlot TimeSlot { get; set; }

    [MaxLength(100, ErrorMessage = "שם הלקוח לא יכול לחרוג מ-100 תווים")]
    public string? CustomerName { get; set; }

    [Required(ErrorMessage = "יש להזין מספר טלפון")]
    [MaxLength(20, ErrorMessage = "מספר הטלפון לא יכול לחרוג מ-20 תווים")]
    public string Phone { get; set; } = string.Empty;

    [MaxLength(20, ErrorMessage = "מספר הטלפון לא יכול לחרוג מ-20 תווים")]
    public string? Phone2 { get; set; }

    [MaxLength(200, ErrorMessage = "הכתובת לא יכולה לחרוג מ-200 תווים")]
    public string? Address { get; set; }

    public DepositType? DepositType { get; set; }

    [MaxLength(100, ErrorMessage = "שם הפיקדון לא יכול לחרוג מ-100 תווים")]
    public string? DepositOnName { get; set; }

    public decimal? PaymentAmount { get; set; }

    public bool IsPaid { get; set; }

    [MaxLength(1000, ErrorMessage = "ההערות לא יכולות לחרוג מ-1000 תווים")]
    public string? Notes { get; set; }

    public List<OrderLoanedEquipmentDto> LoanedEquipments { get; set; } = new();

    /// <summary>
    /// When true, allows creating or moving an order into a slot that already has another order for the same equipment.
    /// </summary>
    public bool AllowDoubleBooking { get; set; }
}
