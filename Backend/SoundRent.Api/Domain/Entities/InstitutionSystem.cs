using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

/// <summary>
/// Maps a unified <see cref="Institution"/> profile to one or more product systems
/// without duplicating the institution directory row.
/// </summary>
public class InstitutionSystem
{
    public int InstitutionId { get; set; }

    public SystemType SystemType { get; set; }

    public Institution Institution { get; set; } = null!;

    public DateTime LinkedAt { get; set; } = DateTime.UtcNow;
}
