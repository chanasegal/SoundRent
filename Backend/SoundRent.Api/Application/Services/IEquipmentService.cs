using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.Services;

public interface IEquipmentService
{
    Task<List<EquipmentDto>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<EquipmentDto> SetMaintenanceModeAsync(
        EquipmentType equipmentType,
        bool isMaintenanceMode,
        CancellationToken cancellationToken = default);
    Task<bool> IsMaintenanceModeAsync(EquipmentType equipmentType, CancellationToken cancellationToken = default);
    Task EnsureAllEquipmentRowsExistAsync(CancellationToken cancellationToken = default);
}
