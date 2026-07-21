using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.Services;

public interface IEquipmentDefaultAccessoryService
{
    Task<List<EquipmentDefaultAccessoryDto>> GetByParentUnitAsync(
        LoanedEquipmentType parentEquipmentType,
        string parentSerialCode,
        CancellationToken cancellationToken = default);

    Task<List<EquipmentDefaultAccessoryCountDto>> GetCountsByParentUnitAsync(
        LoanedEquipmentType? parentEquipmentType = null,
        CancellationToken cancellationToken = default);

    Task<EquipmentDefaultAccessoryDto> CreateAsync(
        CreateEquipmentDefaultAccessoryDto dto,
        CancellationToken cancellationToken = default);

    Task<List<EquipmentDefaultAccessoryDto>> CreateBatchAsync(
        CreateEquipmentDefaultAccessoriesBatchDto dto,
        CancellationToken cancellationToken = default);

    Task DeleteAsync(int id, CancellationToken cancellationToken = default);
}
