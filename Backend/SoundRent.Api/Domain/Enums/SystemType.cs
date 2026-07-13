namespace SoundRent.Api.Domain.Enums;

/// <summary>
/// Product / tenant isolation for weekly boards and related data.
/// Existing rows default to <see cref="Sound"/>.
/// </summary>
public enum SystemType
{
    Sound = 0,
    Tools = 1,
    Library = 2
}
