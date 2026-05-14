using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Application.DTOs;

public class CustomerUpsertDto
{
    [Required]
    [MaxLength(20)]
    public string Phone1 { get; set; } = string.Empty;

    [MaxLength(20)]
    public string? Phone2 { get; set; }

    [MaxLength(200)]
    public string? FullName { get; set; }

    [MaxLength(500)]
    public string? Address { get; set; }

    [MaxLength(4000)]
    public string? Notes { get; set; }
}
