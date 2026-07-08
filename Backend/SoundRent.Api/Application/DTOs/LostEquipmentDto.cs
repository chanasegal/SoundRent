using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class LostEquipmentDto
{
    public int Id { get; set; }

    public string CustomerName { get; set; } = string.Empty;

    public string? Phone { get; set; }

    public string ItemDescription { get; set; } = string.Empty;

    public string HebrewDate { get; set; } = string.Empty;

    public string? Notes { get; set; }

    public LostEquipmentStatus Status { get; set; }

    public DateTime CreatedAt { get; set; }

    public DateTime UpdatedAt { get; set; }
}
