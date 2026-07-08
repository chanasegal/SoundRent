using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Application.DTOs;

public class LostEquipmentCreateDto
{
    [Required(ErrorMessage = "יש להזין שם לקוח")]
    [MaxLength(200, ErrorMessage = "שם הלקוח לא יכול לחרוג מ-200 תווים")]
    public string CustomerName { get; set; } = string.Empty;

    [MaxLength(20, ErrorMessage = "מספר הטלפון לא יכול לחרוג מ-20 תווים")]
    public string? Phone { get; set; }

    [Required(ErrorMessage = "יש להזין תיאור פריט")]
    [MaxLength(500, ErrorMessage = "תיאור הפריט לא יכול לחרוג מ-500 תווים")]
    public string ItemDescription { get; set; } = string.Empty;

    [Required(ErrorMessage = "יש להזין תאריך עברי")]
    [MaxLength(100, ErrorMessage = "התאריך העברי לא יכול לחרוג מ-100 תווים")]
    public string HebrewDate { get; set; } = string.Empty;

    [MaxLength(2000, ErrorMessage = "ההערות לא יכולות לחרוג מ-2000 תווים")]
    public string? Notes { get; set; }
}
