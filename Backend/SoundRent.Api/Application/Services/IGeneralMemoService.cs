using SoundRent.Api.Application.DTOs;

namespace SoundRent.Api.Application.Services;

public interface IGeneralMemoService
{
    Task<GeneralMemoDto> GetAsync(CancellationToken cancellationToken = default);

    Task<GeneralMemoDto> SaveAsync(string? content, CancellationToken cancellationToken = default);
}
