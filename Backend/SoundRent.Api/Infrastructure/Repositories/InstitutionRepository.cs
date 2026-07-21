using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Infrastructure.Repositories;

public class InstitutionRepository : IInstitutionRepository
{
    private const int SearchLimit = 100;

    private readonly AppDbContext _db;

    public InstitutionRepository(AppDbContext db)
    {
        _db = db;
    }

    public Task<List<Institution>> GetAllAsync(
        SystemType? systemType = null,
        CancellationToken cancellationToken = default)
    {
        var query = WithSystems(_db.Institutions.AsNoTracking());
        if (systemType.HasValue)
        {
            query = query.Where(i => i.Systems.Any(s => s.SystemType == systemType.Value));
        }

        return query
            .OrderBy(i => i.Name)
            .ToListAsync(cancellationToken);
    }

    public Task<List<Institution>> SearchAsync(
        string? query,
        SystemType? systemType = null,
        CancellationToken cancellationToken = default)
    {
        var q = (query ?? string.Empty).Trim();
        var rows = WithSystems(_db.Institutions.AsNoTracking());

        if (systemType.HasValue)
        {
            rows = rows.Where(i => i.Systems.Any(s => s.SystemType == systemType.Value));
        }

        if (q.Length > 0)
        {
            var lower = q.ToLowerInvariant();
            rows = rows.Where(i => i.Name.ToLower().Contains(lower));
        }

        return rows
            .OrderBy(i => i.Name)
            .Take(SearchLimit)
            .ToListAsync(cancellationToken);
    }

    public Task<Institution?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        return WithSystems(_db.Institutions.AsNoTracking())
            .FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
    }

    public Task<Institution?> GetByIdTrackedAsync(int id, CancellationToken cancellationToken = default)
    {
        return WithSystems(_db.Institutions)
            .FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
    }

    public Task<Institution?> FindByNameAsync(
        string name,
        SystemType? systemType = null,
        CancellationToken cancellationToken = default)
    {
        var normalized = name.Trim().ToLowerInvariant();
        if (normalized.Length == 0)
        {
            return Task.FromResult<Institution?>(null);
        }

        var query = WithSystems(_db.Institutions.AsNoTracking())
            .Where(i => i.Name.ToLower() == normalized);

        if (systemType.HasValue)
        {
            query = query.Where(i => i.Systems.Any(s => s.SystemType == systemType.Value));
        }

        return query.FirstOrDefaultAsync(cancellationToken);
    }

    public async Task EnsureSystemLinkAsync(
        int institutionId,
        SystemType systemType,
        CancellationToken cancellationToken = default)
    {
        var exists = await _db.InstitutionSystems.AnyAsync(
            s => s.InstitutionId == institutionId && s.SystemType == systemType,
            cancellationToken);
        if (exists)
        {
            return;
        }

        await _db.InstitutionSystems.AddAsync(
            new InstitutionSystem
            {
                InstitutionId = institutionId,
                SystemType = systemType,
                LinkedAt = DateTime.UtcNow
            },
            cancellationToken);
    }

    public async Task AddAsync(Institution institution, CancellationToken cancellationToken = default)
    {
        await _db.Institutions.AddAsync(institution, cancellationToken);
    }

    public void Remove(Institution institution)
    {
        _db.Institutions.Remove(institution);
    }

    public async Task<bool> HasActiveOrFutureOrdersAsync(
        int institutionId,
        DateOnly todayInclusive,
        CancellationToken cancellationToken = default)
    {
        var hasOrders = await _db.Orders.AsNoTracking().AnyAsync(
            o => o.InstitutionId == institutionId
                && !o.IsCancelled
                && o.Shifts.Any(s => s.OrderDate >= todayInclusive),
            cancellationToken);
        if (hasOrders)
        {
            return true;
        }

        return await _db.ToolLoans.AsNoTracking().AnyAsync(
            l => l.InstitutionId == institutionId
                && l.Items.Any(i => i.ReturnedAt == null),
            cancellationToken);
    }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return _db.SaveChangesAsync(cancellationToken);
    }

    private static IQueryable<Institution> WithSystems(IQueryable<Institution> query)
        => query.Include(i => i.Systems);
}
