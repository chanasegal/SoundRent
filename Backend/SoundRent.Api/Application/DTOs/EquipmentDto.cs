using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class EquipmentDto
{
    public EquipmentType EquipmentType { get; set; }
    public bool IsMaintenanceMode { get; set; }
}
