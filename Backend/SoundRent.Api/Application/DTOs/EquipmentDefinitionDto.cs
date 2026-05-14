namespace SoundRent.Api.Application.DTOs;

public class EquipmentDefinitionDto
{
    public string Id { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public int SortOrder { get; set; }

    /// <summary>
    /// True when this booking slot is in maintenance mode (cannot accept new orders).
    /// </summary>
    public bool IsUnderMaintenance { get; set; }
}
