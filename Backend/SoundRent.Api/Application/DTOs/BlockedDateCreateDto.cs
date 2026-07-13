using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class BlockedDateCreateDto
{
    [Required(ErrorMessage = "יש להזין תאריך התחלה")]
    public DateOnly StartDate { get; set; }

    [Required(ErrorMessage = "יש להזין תאריך סיום")]
    public DateOnly EndDate { get; set; }

    [MaxLength(500, ErrorMessage = "הסיבה לא יכולה לחרוג מ-500 תווים")]
    public string? Reason { get; set; }

    public SystemType SystemType { get; set; } = SystemType.Tools;
}
