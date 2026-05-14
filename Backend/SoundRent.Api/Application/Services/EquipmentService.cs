using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Application.Services;

public class EquipmentService : IEquipmentService
{
    private readonly IEquipmentRepository _equipmentRepository;

    public EquipmentService(IEquipmentRepository equipmentRepository)
    {
        _equipmentRepository = equipmentRepository;
    }

    public async Task<List<EquipmentDto>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await EnsureAllEquipmentRowsExistAsync(cancellationToken);
        var rows = await _equipmentRepository.GetAllAsync(cancellationToken);
        return rows.Select(ToDto).ToList();
    }

    public async Task<EquipmentDto> SetMaintenanceModeAsync(
        EquipmentType equipmentType,
        bool isMaintenanceMode,
        CancellationToken cancellationToken = default)
    {
        await EnsureAllEquipmentRowsExistAsync(cancellationToken);

        var entity = await _equipmentRepository.GetByTypeAsync(equipmentType, cancellationToken)
            ?? throw new NotFoundException("הציוד לא נמצא");

        entity.IsMaintenanceMode = isMaintenanceMode;
        await _equipmentRepository.SaveChangesAsync(cancellationToken);

        return ToDto(entity);
    }

    public async Task<bool> IsMaintenanceModeAsync(
        EquipmentType equipmentType,
        CancellationToken cancellationToken = default)
    {
        await EnsureAllEquipmentRowsExistAsync(cancellationToken);
        var entity = await _equipmentRepository.GetByTypeAsync(equipmentType, cancellationToken);
        return entity?.IsMaintenanceMode ?? false;
    }

    public async Task EnsureAllEquipmentRowsExistAsync(CancellationToken cancellationToken = default)
    {
        var existingRows = await _equipmentRepository.GetAllAsync(cancellationToken);
        var existingTypes = existingRows.Select(x => x.EquipmentType).ToHashSet();

        var missing = Enum
            .GetValues<EquipmentType>()
            .Where(type => !existingTypes.Contains(type))
            .Select(type => new Equipment
            {
                EquipmentType = type,
                IsMaintenanceMode = false
            })
            .ToList();

        if (missing.Count == 0)
        {
            return;
        }

        await _equipmentRepository.AddRangeAsync(missing, cancellationToken);
        await _equipmentRepository.SaveChangesAsync(cancellationToken);
    }

    private static EquipmentDto ToDto(Equipment entity)
    {
        return new EquipmentDto
        {
            EquipmentType = entity.EquipmentType,
            IsMaintenanceMode = entity.IsMaintenanceMode
        };
    }
}
