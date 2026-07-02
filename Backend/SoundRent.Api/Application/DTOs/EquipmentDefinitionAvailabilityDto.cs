namespace SoundRent.Api.Application.DTOs;

public class EquipmentDefinitionAvailabilityDto
{
    public string Id { get; set; } = string.Empty;
    public string DisplayName { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public bool IsUnderMaintenance { get; set; }

    /// <summary>
    /// True when at least one selected shift is already booked for this equipment slot.
    /// </summary>
    public bool IsOccupied { get; set; }
}
