using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

/// <summary>
/// Creates one or more equipment definition rows from a shared display name/category
/// and a list of unique item codes (each code becomes a definition Id).
/// </summary>
public class EquipmentDefinitionBatchCreateDto
{
    [Required(ErrorMessage = "יש להזין שם פריט")]
    [MaxLength(200, ErrorMessage = "שם הפריט ארוך מדי")]
    public string DisplayName { get; set; } = string.Empty;

    [Required(ErrorMessage = "יש לבחור קטגוריה")]
    [MaxLength(80, ErrorMessage = "הקטגוריה ארוכה מדי")]
    public string Category { get; set; } = string.Empty;

    /// <summary>
    /// Unique item / tracking codes. Each non-empty code creates one definition row.
    /// </summary>
    [Required(ErrorMessage = "יש להזין לפחות קוד פריט אחד")]
    [MinLength(1, ErrorMessage = "יש להזין לפחות קוד פריט אחד")]
    public List<string> ItemCodes { get; set; } = new();

    public SystemType SystemType { get; set; } = SystemType.Tools;
}
