using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class WaitlistEntryCreateDto
{
    [MaxLength(100, ErrorMessage = "השם לא יכול לחרוג מ-100 תווים")]
    public string? CustomerName { get; set; }

    [Required(ErrorMessage = "יש להזין טלפון")]
    [MaxLength(20, ErrorMessage = "מספר הטלפון לא יכול לחרוג מ-20 תווים")]
    public string Phone { get; set; } = string.Empty;

    [Required(ErrorMessage = "יש לבחור סוג ציוד")]
    public EquipmentType EquipmentType { get; set; }

    [Required(ErrorMessage = "יש לבחור תאריך")]
    public DateOnly Date { get; set; }

    [MaxLength(1000, ErrorMessage = "ההערות לא יכולות לחרוג מ-1000 תווים")]
    public string? Notes { get; set; }
}
