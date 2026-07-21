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

    /// <summary>
    /// Returns an existing catalog row by display name (case-insensitive), or creates a custom row with quantity 0.
    /// </summary>
    Task<InventoryDefinitionDto> EnsureByDisplayNameAsync(
        string displayName,
        CancellationToken cancellationToken = default);

    /// <summary>Ensures a serial exists on the catalog row and marks it Missing.</summary>
    Task MarkSerialMissingAsync(
        int inventoryDefinitionId,
        string serialCode,
        CancellationToken cancellationToken = default);

    /// <summary>Restores a catalog serial to InWarehouse when present.</summary>
    Task RestoreSerialAsync(
        int inventoryDefinitionId,
        string serialCode,
        CancellationToken cancellationToken = default);
}
