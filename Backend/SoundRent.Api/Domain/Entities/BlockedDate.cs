using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

/// <summary>Date range during which new equipment bookings are blocked (family events, vacations, etc.).</summary>
public class BlockedDate
{
    public int Id { get; set; }

    public DateOnly StartDate { get; set; }

    public DateOnly EndDate { get; set; }

    [MaxLength(500)]
    public string? Reason { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Which product system this block applies to.</summary>
    public SystemType SystemType { get; set; } = SystemType.Sound;
}
