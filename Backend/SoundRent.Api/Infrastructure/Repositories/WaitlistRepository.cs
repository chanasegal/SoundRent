using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Infrastructure.Repositories;

public class WaitlistRepository : IWaitlistRepository
{
    private readonly AppDbContext _db;

    public WaitlistRepository(AppDbContext db)
    {
        _db = db;
    }

    public Task<List<WaitlistEntry>> GetByDateRangeAsync(
        DateOnly startDate,
        DateOnly endDate,
        CancellationToken cancellationToken = default)
    {
        return _db.WaitlistEntries
            .AsNoTracking()
            .Where(e => e.WaitlistDate >= startDate && e.WaitlistDate <= endDate)
            .OrderBy(e => e.WaitlistDate)
            .ThenBy(e => e.EquipmentType)
            .ThenBy(e => e.CreatedAt)
            .ToListAsync(cancellationToken);
    }

    public Task<List<WaitlistEntry>> GetAllOrderedForExportAsync(CancellationToken cancellationToken = default)
    {
        return _db.WaitlistEntries
            .AsNoTracking()
            .OrderBy(e => e.WaitlistDate)
            .ThenBy(e => e.CreatedAt)
            .ThenBy(e => e.Id)
            .ToListAsync(cancellationToken);
    }

    public Task<WaitlistEntry?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        return _db.WaitlistEntries.FirstOrDefaultAsync(e => e.Id == id, cancellationToken);
    }

    public async Task AddAsync(WaitlistEntry entry, CancellationToken cancellationToken = default)
    {
        await _db.WaitlistEntries.AddAsync(entry, cancellationToken);
    }

    public void Remove(WaitlistEntry entry)
    {
        _db.WaitlistEntries.Remove(entry);
    }

    public Task SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return _db.SaveChangesAsync(cancellationToken);
    }
}
