using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Infrastructure.Repositories;

public class LostEquipmentRepository : ILostEquipmentRepository
{
    private readonly AppDbContext _db;

    public LostEquipmentRepository(AppDbContext db)
    {
        _db = db;
    }

    public Task<List<LostEquipment>> GetAllOrderedAsync(CancellationToken cancellationToken = default)
    {
        return _db.LostEquipments
            .AsNoTracking()
            .OrderByDescending(e => e.UpdatedAt)
            .ThenByDescending(e => e.Id)
            .ToListAsync(cancellationToken);
    }

    public Task<LostEquipment?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        return _db.LostEquipments.FirstOrDefaultAsync(e => e.Id == id, cancellationToken);
    }

    public async Task AddAsync(LostEquipment entity, CancellationToken cancellationToken = default)
    {
        await _db.LostEquipments.AddAsync(entity, cancellationToken);
    }

    public void Remove(LostEquipment entity)
    {
        _db.LostEquipments.Remove(entity);
    }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return _db.SaveChangesAsync(cancellationToken);
    }
}
