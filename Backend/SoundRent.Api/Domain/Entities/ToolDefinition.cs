using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Domain.Entities;

/// <summary>
/// Tools-workspace inventory catalog row (isolated from Sound accessory inventory).
/// </summary>
public class ToolDefinition
{
    public int Id { get; set; }

    [Required]
    [MaxLength(200)]
    public string DisplayName { get; set; } = string.Empty;

    public int SortOrder { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<ToolSerialCode> SerialCodes { get; set; } = new List<ToolSerialCode>();
}
