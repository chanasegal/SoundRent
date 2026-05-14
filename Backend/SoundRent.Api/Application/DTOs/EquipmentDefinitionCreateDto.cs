using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Application.DTOs;

public class EquipmentDefinitionCreateDto
{
    [Required(ErrorMessage = "יש להזין מזהה ייחודי לתא")]
    [MaxLength(64, ErrorMessage = "המזהה ארוך מדי")]
    public string Id { get; set; } = string.Empty;

    [Required(ErrorMessage = "יש להזין שם תצוגה")]
    [MaxLength(200, ErrorMessage = "שם התצוגה ארוך מדי")]
    public string DisplayName { get; set; } = string.Empty;

    [Required(ErrorMessage = "יש לבחור קטגוריה")]
    [MaxLength(80, ErrorMessage = "הקטגוריה ארוכה מדי")]
    public string Category { get; set; } = string.Empty;

    [Range(0, 1_000_000)]
    public int SortOrder { get; set; }
}
