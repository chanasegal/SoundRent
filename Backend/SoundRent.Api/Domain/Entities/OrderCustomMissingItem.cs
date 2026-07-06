using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Domain.Entities;

public class OrderCustomMissingItem
{
    public int Id { get; set; }

    public int OrderId { get; set; }
    public Order Order { get; set; } = null!;

    [MaxLength(200)]
    public string ItemName { get; set; } = string.Empty;

    public int MissingQuantity { get; set; }

    public bool IsResolved { get; set; }
}
