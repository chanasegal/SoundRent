using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class WaitlistEntryDto
{
    public int Id { get; set; }
    public string? CustomerName { get; set; }
    public string Phone { get; set; } = string.Empty;
    public EquipmentType EquipmentType { get; set; }
    public DateOnly Date { get; set; }
    public string? Notes { get; set; }
    public DateTime CreatedAt { get; set; }
}
