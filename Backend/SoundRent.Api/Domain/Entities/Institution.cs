using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Domain.Entities;

public class Institution
{
    public int Id { get; set; }

    [Required]
    [MaxLength(200)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(2000)]
    public string? DefaultNote { get; set; }

    public ICollection<Order> Orders { get; set; } = new List<Order>();
}
