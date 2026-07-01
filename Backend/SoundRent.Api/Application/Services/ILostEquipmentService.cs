using SoundRent.Api.Application.DTOs;

namespace SoundRent.Api.Application.Services;

public interface ILostEquipmentService
{
    Task<List<LostEquipmentDto>> GetAllAsync(CancellationToken cancellationToken = default);

    Task<LostEquipmentDto> CreateAsync(LostEquipmentCreateDto dto, CancellationToken cancellationToken = default);

    Task<LostEquipmentDto> UpdateAsync(int id, LostEquipmentUpdateDto dto, CancellationToken cancellationToken = default);

    Task DeleteAsync(int id, CancellationToken cancellationToken = default);
}
