using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Repositories;

public interface IInventoryDefinitionRepository
{
    Task<List<InventoryDefinition>> GetAllWithSerialsOrderedAsync(CancellationToken cancellationToken = default);

    Task<InventoryDefinition?> GetByIdWithSerialsAsync(int id, CancellationToken cancellationToken = default);

    Task<bool> DisplayNameExistsAsync(
        string displayName,
        int? excludeId = null,
        CancellationToken cancellationToken = default);

    Task<InventoryDefinition?> FindByDisplayNameAsync(
        string displayName,
        CancellationToken cancellationToken = default);

    Task<int> GetNextSortOrderAsync(CancellationToken cancellationToken = default);

    Task AddAsync(InventoryDefinition entity, CancellationToken cancellationToken = default);

    void Remove(InventoryDefinition entity);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
