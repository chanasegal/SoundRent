using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Infrastructure.Repositories;

public interface IEquipmentDefinitionRepository
{
    Task<IReadOnlyList<EquipmentDefinition>> GetAllOrderedAsync(
        SystemType? systemType = null,
        CancellationToken cancellationToken = default);

    Task<bool> ExistsAsync(string id, CancellationToken cancellationToken = default);

    Task<EquipmentDefinition?> GetByIdAsync(string id, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<EquipmentDefinition>> GetByIdsAsync(
        IReadOnlyCollection<string> ids,
        CancellationToken cancellationToken = default);

    Task AddAsync(EquipmentDefinition entity, CancellationToken cancellationToken = default);

    void Remove(EquipmentDefinition entity);

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
