using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Domain.Entities;
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

    public Task<List<Institution>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        return _db.Institutions
            .AsNoTracking()
            .OrderBy(i => i.Name)
            .ToListAsync(cancellationToken);
    }

    public Task<List<Institution>> SearchAsync(string? query, CancellationToken cancellationToken = default)
    {
        var q = (query ?? string.Empty).Trim();
        IQueryable<Institution> rows = _db.Institutions.AsNoTracking();

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
        return _db.Institutions.AsNoTracking().FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
    }

    public Task<Institution?> GetByIdTrackedAsync(int id, CancellationToken cancellationToken = default)
    {
        return _db.Institutions.FirstOrDefaultAsync(i => i.Id == id, cancellationToken);
    }

    public Task<Institution?> FindByNameAsync(string name, CancellationToken cancellationToken = default)
    {
        var normalized = name.Trim().ToLowerInvariant();
        if (normalized.Length == 0)
        {
            return Task.FromResult<Institution?>(null);
        }

        return _db.Institutions
            .AsNoTracking()
            .FirstOrDefaultAsync(i => i.Name.ToLower() == normalized, cancellationToken);
    }

    public async Task AddAsync(Institution institution, CancellationToken cancellationToken = default)
    {
        await _db.Institutions.AddAsync(institution, cancellationToken);
    }

    public void Remove(Institution institution)
    {
        _db.Institutions.Remove(institution);
    }

    public Task<bool> HasActiveOrFutureOrdersAsync(
        int institutionId,
        DateOnly todayInclusive,
        CancellationToken cancellationToken = default)
    {
        return _db.Orders.AsNoTracking().AnyAsync(
            o => o.InstitutionId == institutionId
                && !o.IsCancelled
                && o.Shifts.Any(s => s.OrderDate >= todayInclusive),
            cancellationToken);
    }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return _db.SaveChangesAsync(cancellationToken);
    }
}
