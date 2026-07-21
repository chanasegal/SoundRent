using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Infrastructure.Repositories;

public class InventoryDefinitionRepository : IInventoryDefinitionRepository
{
    private readonly AppDbContext _db;

    public InventoryDefinitionRepository(AppDbContext db)
    {
        _db = db;
    }

    public Task<List<InventoryDefinition>> GetAllWithSerialsOrderedAsync(CancellationToken cancellationToken = default) =>
        _db.InventoryDefinitions
            .AsNoTracking()
            .Include(d => d.SerialCodes)
            .OrderBy(d => d.SortOrder)
            .ThenBy(d => d.Id)
            .ToListAsync(cancellationToken);

    public Task<InventoryDefinition?> GetByIdWithSerialsAsync(int id, CancellationToken cancellationToken = default) =>
        _db.InventoryDefinitions
            .Include(d => d.SerialCodes)
            .FirstOrDefaultAsync(d => d.Id == id, cancellationToken);

    public Task<bool> DisplayNameExistsAsync(
        string displayName,
        int? excludeId = null,
        CancellationToken cancellationToken = default)
    {
        var trimmed = displayName.Trim();
        return _db.InventoryDefinitions.AnyAsync(
            d => d.DisplayName == trimmed && (excludeId == null || d.Id != excludeId.Value),
            cancellationToken);
    }

    public Task<InventoryDefinition?> FindByDisplayNameAsync(
        string displayName,
        CancellationToken cancellationToken = default)
    {
        var normalized = displayName.Trim().ToLower();
        return _db.InventoryDefinitions
            .AsNoTracking()
            .Include(d => d.SerialCodes)
            .FirstOrDefaultAsync(
                d => d.DisplayName.ToLower() == normalized,
                cancellationToken);
    }

    public async Task<int> GetNextSortOrderAsync(CancellationToken cancellationToken = default)
    {
        if (!await _db.InventoryDefinitions.AnyAsync(cancellationToken))
        {
            return 0;
        }

        return await _db.InventoryDefinitions.MaxAsync(d => d.SortOrder, cancellationToken) + 1;
    }

    public async Task AddAsync(InventoryDefinition entity, CancellationToken cancellationToken = default) =>
        await _db.InventoryDefinitions.AddAsync(entity, cancellationToken);

    public void Remove(InventoryDefinition entity) => _db.InventoryDefinitions.Remove(entity);

    public Task SaveChangesAsync(CancellationToken cancellationToken = default) =>
        _db.SaveChangesAsync(cancellationToken);
}
