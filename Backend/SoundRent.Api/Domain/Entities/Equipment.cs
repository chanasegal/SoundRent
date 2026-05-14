using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

public class Equipment
{
    public int Id { get; set; }
    public EquipmentType EquipmentType { get; set; }
    public bool IsMaintenanceMode { get; set; }
}
