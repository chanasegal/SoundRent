using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

/// <summary>
/// Maps a unified <see cref="Customer"/> profile to one or more product systems
/// without duplicating contact details.
/// </summary>
public class CustomerSystem
{
    [MaxLength(20)]
    public string CustomerPhone1 { get; set; } = string.Empty;

    public SystemType SystemType { get; set; }

    public Customer Customer { get; set; } = null!;

    public DateTime LinkedAt { get; set; } = DateTime.UtcNow;
}
