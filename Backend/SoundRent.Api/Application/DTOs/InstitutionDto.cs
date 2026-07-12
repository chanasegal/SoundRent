using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Application.DTOs;

public class InstitutionDto
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? DefaultNote { get; set; }
}

public class InstitutionCreateUpdateDto
{
    [Required(ErrorMessage = "יש להזין שם מוסד")]
    [MaxLength(200, ErrorMessage = "שם המוסד לא יכול לחרוג מ-200 תווים")]
    public string Name { get; set; } = string.Empty;

    [MaxLength(2000, ErrorMessage = "ההערה לא יכולה לחרוג מ-2000 תווים")]
    public string? DefaultNote { get; set; }
}
