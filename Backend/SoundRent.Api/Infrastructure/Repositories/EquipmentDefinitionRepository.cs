using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Infrastructure.Repositories;

public class EquipmentDefinitionRepository : IEquipmentDefinitionRepository
{
    private readonly AppDbContext _db;

    public EquipmentDefinitionRepository(AppDbContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<EquipmentDefinition>> GetAllOrderedAsync(CancellationToken cancellationToken = default)
    {
        var list = await _db.EquipmentDefinitions
            .AsNoTracking()
            .OrderBy(e => e.SortOrder)
            .ThenBy(e => e.Id)
            .ToListAsync(cancellationToken);
        return list;
    }

    public Task<bool> ExistsAsync(string id, CancellationToken cancellationToken = default)
    {
        var trimmed = id.Trim();
        return _db.EquipmentDefinitions.AsNoTracking().AnyAsync(e => e.Id == trimmed, cancellationToken);
    }

    public Task<EquipmentDefinition?> GetByIdAsync(string id, CancellationToken cancellationToken = default)
    {
        var trimmed = id.Trim();
        return _db.EquipmentDefinitions.FirstOrDefaultAsync(e => e.Id == trimmed, cancellationToken);
    }

    public async Task AddAsync(EquipmentDefinition entity, CancellationToken cancellationToken = default)
    {
        await _db.EquipmentDefinitions.AddAsync(entity, cancellationToken);
    }

    public void Remove(EquipmentDefinition entity)
    {
        _db.EquipmentDefinitions.Remove(entity);
    }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return _db.SaveChangesAsync(cancellationToken);
    }
}
