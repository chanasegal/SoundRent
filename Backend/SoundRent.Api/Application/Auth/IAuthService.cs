using SoundRent.Api.Application.DTOs;

namespace SoundRent.Api.Application.Auth;

public interface IAuthService
{
    Task<AuthResponseDto> LoginAsync(LoginDto dto, CancellationToken cancellationToken = default);
}
