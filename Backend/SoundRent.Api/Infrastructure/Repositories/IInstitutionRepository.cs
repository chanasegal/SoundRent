using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Repositories;

public interface IInstitutionRepository
{
    Task<List<Institution>> GetAllAsync(CancellationToken cancellationToken = default);

    Task<List<Institution>> SearchAsync(string? query, CancellationToken cancellationToken = default);

    Task<Institution?> GetByIdAsync(int id, CancellationToken cancellationToken = default);

    Task<Institution?> GetByIdTrackedAsync(int id, CancellationToken cancellationToken = default);

    Task<Institution?> FindByNameAsync(string name, CancellationToken cancellationToken = default);

    Task AddAsync(Institution institution, CancellationToken cancellationToken = default);

    void Remove(Institution institution);

    Task<bool> HasActiveOrFutureOrdersAsync(
        int institutionId,
        DateOnly todayInclusive,
        CancellationToken cancellationToken = default);

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
