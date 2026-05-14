using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Infrastructure.Repositories;

public interface IEquipmentRepository
{
    Task<List<Equipment>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<Equipment?> GetByTypeAsync(EquipmentType equipmentType, CancellationToken cancellationToken = default);
    Task AddRangeAsync(IEnumerable<Equipment> equipments, CancellationToken cancellationToken = default);
    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
