using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Repositories;

public interface IWaitlistRepository
{
    Task<List<WaitlistEntry>> GetByDateRangeAsync(DateOnly startDate, DateOnly endDate, CancellationToken cancellationToken = default);

    /// <summary>All waitlist rows for full backup export, ordered by requested date then creation time.</summary>
    Task<List<WaitlistEntry>> GetAllOrderedForExportAsync(CancellationToken cancellationToken = default);

    Task<WaitlistEntry?> GetByIdAsync(int id, CancellationToken cancellationToken = default);

    Task AddAsync(WaitlistEntry entry, CancellationToken cancellationToken = default);

    void Remove(WaitlistEntry entry);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
