using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Infrastructure.Repositories;

public class BlockedDateRepository : IBlockedDateRepository
{
    private readonly AppDbContext _db;

    public BlockedDateRepository(AppDbContext db)
    {
        _db = db;
    }

    public Task<List<BlockedDate>> GetAllOrderedAsync(CancellationToken cancellationToken = default)
    {
        return _db.BlockedDates
            .AsNoTracking()
            .OrderBy(b => b.StartDate)
            .ThenBy(b => b.EndDate)
            .ThenBy(b => b.Id)
            .ToListAsync(cancellationToken);
    }

    public Task<List<BlockedDate>> GetOverlappingAsync(
        DateOnly rangeStart,
        DateOnly rangeEnd,
        CancellationToken cancellationToken = default)
    {
        return _db.BlockedDates
            .AsNoTracking()
            .Where(b => b.StartDate <= rangeEnd && b.EndDate >= rangeStart)
            .OrderBy(b => b.StartDate)
            .ThenBy(b => b.EndDate)
            .ThenBy(b => b.Id)
            .ToListAsync(cancellationToken);
    }

    public Task<BlockedDate?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        return _db.BlockedDates.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
    }

    public Task<bool> AnyBlockCoversDateAsync(DateOnly date, CancellationToken cancellationToken = default)
    {
        return _db.BlockedDates
            .AsNoTracking()
            .AnyAsync(b => b.StartDate <= date && b.EndDate >= date, cancellationToken);
    }

    public async Task AddAsync(BlockedDate entity, CancellationToken cancellationToken = default)
    {
        await _db.BlockedDates.AddAsync(entity, cancellationToken);
    }

    public void Remove(BlockedDate entity)
    {
        _db.BlockedDates.Remove(entity);
    }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return _db.SaveChangesAsync(cancellationToken);
    }
}
