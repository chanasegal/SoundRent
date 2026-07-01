using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Repositories;

public interface ILostEquipmentRepository
{
    Task<List<LostEquipment>> GetAllOrderedAsync(CancellationToken cancellationToken = default);

    Task<LostEquipment?> GetByIdAsync(int id, CancellationToken cancellationToken = default);

    Task AddAsync(LostEquipment entity, CancellationToken cancellationToken = default);

    void Remove(LostEquipment entity);

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
