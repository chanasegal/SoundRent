using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Domain.Entities;

/// <summary>Singleton workspace memo shared across all users.</summary>
public class GeneralMemo
{
    public const int SingletonId = 1;

    public int Id { get; set; } = SingletonId;

    [MaxLength(8000)]
    public string Content { get; set; } = string.Empty;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
