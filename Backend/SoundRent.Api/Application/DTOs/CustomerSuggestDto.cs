namespace SoundRent.Api.Application.DTOs;

/// <summary>Lean projection for typeahead — no Notes / system links.</summary>
public class CustomerSuggestDto
{
    public string Phone1 { get; set; } = string.Empty;

    public string? Phone2 { get; set; }

    public string? FullName { get; set; }

    public string? Address { get; set; }
}
