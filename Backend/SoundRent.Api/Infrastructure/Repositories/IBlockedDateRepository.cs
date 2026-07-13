using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Infrastructure.Repositories;

public interface IBlockedDateRepository
{
    Task<List<BlockedDate>> GetAllOrderedAsync(
        SystemType? systemType = null,
        CancellationToken cancellationToken = default);

    Task<List<BlockedDate>> GetOverlappingAsync(
        DateOnly rangeStart,
        DateOnly rangeEnd,
        SystemType? systemType = null,
        CancellationToken cancellationToken = default);

    Task<BlockedDate?> GetByIdAsync(int id, CancellationToken cancellationToken = default);

    Task<bool> AnyBlockCoversDateAsync(
        DateOnly date,
        SystemType? systemType = null,
        CancellationToken cancellationToken = default);

    Task AddAsync(BlockedDate entity, CancellationToken cancellationToken = default);

    void Remove(BlockedDate entity);

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
