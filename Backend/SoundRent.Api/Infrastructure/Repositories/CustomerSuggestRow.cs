namespace SoundRent.Api.Infrastructure.Repositories;

/// <summary>Projection row for lean customer autocomplete (no Notes / systems).</summary>
public sealed class CustomerSuggestRow
{
    public string Phone1 { get; init; } = string.Empty;

    public string? Phone2 { get; init; }

    public string? FullName { get; init; }

    public string? Address { get; init; }
}
