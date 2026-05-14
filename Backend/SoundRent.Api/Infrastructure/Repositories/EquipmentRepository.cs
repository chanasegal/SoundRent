using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Infrastructure.Repositories;

public class EquipmentRepository : IEquipmentRepository
{
    private readonly AppDbContext _db;

    public EquipmentRepository(AppDbContext db)
    {
        _db = db;
    }

    public Task<List<Equipment>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        return _db.Equipments
            .OrderBy(e => e.EquipmentType)
            .ToListAsync(cancellationToken);
    }

    public Task<Equipment?> GetByTypeAsync(EquipmentType equipmentType, CancellationToken cancellationToken = default)
    {
        return _db.Equipments.FirstOrDefaultAsync(e => e.EquipmentType == equipmentType, cancellationToken);
    }

    public async Task AddRangeAsync(IEnumerable<Equipment> equipments, CancellationToken cancellationToken = default)
    {
        await _db.Equipments.AddRangeAsync(equipments, cancellationToken);
    }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return _db.SaveChangesAsync(cancellationToken);
    }
}
