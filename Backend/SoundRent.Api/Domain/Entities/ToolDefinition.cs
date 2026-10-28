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

    /// <summary>Tracked stock quantity — mirrors serial-code count when serials are assigned.</summary>
    public int Quantity { get; set; }

    /// <summary>
    /// When true (default), units are tracked with individual serial codes.
    /// When false, stock is quantity-only (no serial codes required or generated).
    /// </summary>
    public bool RequiresCode { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<ToolSerialCode> SerialCodes { get; set; } = new List<ToolSerialCode>();
}
