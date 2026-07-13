using SoundRent.Api.Application.DTOs;

namespace SoundRent.Api.Application.Services;

public interface IInventoryDefinitionService
{
    Task<List<InventoryDefinitionDto>> GetAllAsync(CancellationToken cancellationToken = default);

    Task<InventoryDefinitionDto> CreateAsync(
        InventoryDefinitionCreateDto dto,
        CancellationToken cancellationToken = default);

    Task<InventoryDefinitionDto> UpdateAsync(
        int id,
        InventoryDefinitionUpdateDto dto,
        CancellationToken cancellationToken = default);

    Task<InventoryDefinitionDto> ReplaceSerialsAsync(
        int id,
        InventoryDefinitionSerialsUpdateDto dto,
        CancellationToken cancellationToken = default);

    Task<List<InventoryDefinitionDto>> ReplaceSerialsBatchAsync(
        InventoryDefinitionBatchUpdateDto dto,
        CancellationToken cancellationToken = default);

    Task DeleteAsync(int id, CancellationToken cancellationToken = default);

    Task EnsureSystemTypesSeededAsync(CancellationToken cancellationToken = default);
}
