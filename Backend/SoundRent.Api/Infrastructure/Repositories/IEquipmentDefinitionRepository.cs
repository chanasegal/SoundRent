using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Repositories;

public interface IEquipmentDefinitionRepository
{
    Task<IReadOnlyList<EquipmentDefinition>> GetAllOrderedAsync(CancellationToken cancellationToken = default);

    Task<bool> ExistsAsync(string id, CancellationToken cancellationToken = default);

    Task<EquipmentDefinition?> GetByIdAsync(string id, CancellationToken cancellationToken = default);

    Task AddAsync(EquipmentDefinition entity, CancellationToken cancellationToken = default);

    void Remove(EquipmentDefinition entity);

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
