using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.Services;

public interface IBlockedDateService
{
    Task<List<BlockedDateDto>> GetAllAsync(
        SystemType? systemType = null,
        CancellationToken cancellationToken = default);

    Task<List<BlockedDateDto>> GetOverlappingAsync(
        DateOnly? rangeStart,
        DateOnly? rangeEnd,
        SystemType? systemType = null,
        CancellationToken cancellationToken = default);

    Task<BlockedDateDto> CreateAsync(BlockedDateCreateDto dto, CancellationToken cancellationToken = default);

    Task<BlockedDateDto> UpdateAsync(int id, BlockedDateUpdateDto dto, CancellationToken cancellationToken = default);

    Task DeleteAsync(int id, CancellationToken cancellationToken = default);
}
