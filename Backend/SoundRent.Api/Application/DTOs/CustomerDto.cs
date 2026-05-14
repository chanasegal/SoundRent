namespace SoundRent.Api.Application.DTOs;

public class CustomerDto
{
    public string Phone1 { get; set; } = string.Empty;

    public string? Phone2 { get; set; }

    public string? FullName { get; set; }

    public string? Address { get; set; }

    public string? Notes { get; set; }

    public DateTime UpdatedAt { get; set; }
}
