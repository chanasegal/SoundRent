using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Application.DTOs;

public class EquipmentDefinitionUpdateDto
{
    [Required(ErrorMessage = "יש להזין שם תצוגה")]
    [MaxLength(200, ErrorMessage = "שם התצוגה ארוך מדי")]
    public string DisplayName { get; set; } = string.Empty;

    [Range(0, 1_000_000)]
    public int SortOrder { get; set; }
}
