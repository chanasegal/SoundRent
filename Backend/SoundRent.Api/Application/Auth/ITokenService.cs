using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Application.Auth;

public interface ITokenService
{
    (string Token, DateTime ExpiresAt) CreateToken(User user);
}
