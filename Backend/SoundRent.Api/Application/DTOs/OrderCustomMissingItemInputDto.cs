using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Application.DTOs;

public class OrderCustomMissingItemInputDto
{
    /// <summary>When set, updates an existing pending custom item on the order.</summary>
    public int? Id { get; set; }

    [Required]
    [MaxLength(200)]
    public string ItemName { get; set; } = string.Empty;

    [Range(1, int.MaxValue)]
    public int MissingQuantity { get; set; }
}
