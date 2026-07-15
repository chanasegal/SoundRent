using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Domain.Entities;

/// <summary>Unit / serial code belonging to a <see cref="Book"/>.</summary>
public class BookCopy
{
    public int Id { get; set; }

    public int BookId { get; set; }

    public Book Book { get; set; } = null!;

    [Required]
    [MaxLength(100)]
    public string CopyNumber { get; set; } = string.Empty;
}
