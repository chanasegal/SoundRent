using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Infrastructure.Repositories;

public class BlockedDateRepository : IBlockedDateRepository
{
    private readonly AppDbContext _db;

    public BlockedDateRepository(AppDbContext db)
    {
        _db = db;
    }

    public Task<List<BlockedDate>> GetAllOrderedAsync(
        SystemType? systemType = null,
        CancellationToken cancellationToken = default)
    {
        var query = _db.BlockedDates.AsNoTracking();

        if (systemType.HasValue)
        {
            query = query.Where(b => b.SystemType == systemType.Value);
        }

        return query
            .OrderBy(b => b.StartDate)
            .ThenBy(b => b.EndDate)
            .ThenBy(b => b.Id)
            .ToListAsync(cancellationToken);
    }

    public Task<List<BlockedDate>> GetOverlappingAsync(
        DateOnly rangeStart,
        DateOnly rangeEnd,
        SystemType? systemType = null,
        CancellationToken cancellationToken = default)
    {
        var query = _db.BlockedDates
            .AsNoTracking()
            .Where(b => b.StartDate <= rangeEnd && b.EndDate >= rangeStart);

        if (systemType.HasValue)
        {
            query = query.Where(b => b.SystemType == systemType.Value);
        }

        return query
            .OrderBy(b => b.StartDate)
            .ThenBy(b => b.EndDate)
            .ThenBy(b => b.Id)
            .ToListAsync(cancellationToken);
    }

    public Task<BlockedDate?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        return _db.BlockedDates.FirstOrDefaultAsync(b => b.Id == id, cancellationToken);
    }

    public Task<bool> AnyBlockCoversDateAsync(
        DateOnly date,
        SystemType? systemType = null,
        CancellationToken cancellationToken = default)
    {
        var query = _db.BlockedDates
            .AsNoTracking()
            .Where(b => b.StartDate <= date && b.EndDate >= date);

        if (systemType.HasValue)
        {
            query = query.Where(b => b.SystemType == systemType.Value);
        }

        return query.AnyAsync(cancellationToken);
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
