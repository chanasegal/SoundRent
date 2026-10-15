using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Infrastructure.Repositories;

public interface IEquipmentDefinitionRepository
{
    /// <summary>Active (non soft-deleted) definitions only.</summary>
    Task<IReadOnlyList<EquipmentDefinition>> GetAllOrderedAsync(
        SystemType? systemType = null,
        CancellationToken cancellationToken = default);

    /// <summary>Includes soft-deleted rows so historical orders remain valid.</summary>
    Task<bool> ExistsAsync(string id, CancellationToken cancellationToken = default);

    /// <summary>Includes soft-deleted rows.</summary>
    Task<EquipmentDefinition?> GetByIdAsync(string id, CancellationToken cancellationToken = default);

    /// <summary>Includes soft-deleted rows.</summary>
    Task<IReadOnlyList<EquipmentDefinition>> GetByIdsAsync(
        IReadOnlyCollection<string> ids,
        CancellationToken cancellationToken = default);

    Task AddAsync(EquipmentDefinition entity, CancellationToken cancellationToken = default);

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
