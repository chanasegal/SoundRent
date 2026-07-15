using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Domain.Entities;

/// <summary>
/// Library-workspace inventory catalog row (isolated from Sound accessory inventory).
/// </summary>
public class Book
{
    public int Id { get; set; }

    [Required]
    [MaxLength(200)]
    public string Title { get; set; } = string.Empty;

    [MaxLength(200)]
    public string? Author { get; set; }

    [MaxLength(100)]
    public string? Category { get; set; }

    public int SortOrder { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public ICollection<BookCopy> Copies { get; set; } = new List<BookCopy>();
}
