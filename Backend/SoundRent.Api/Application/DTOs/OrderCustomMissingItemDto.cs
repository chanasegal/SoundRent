namespace SoundRent.Api.Application.DTOs;

public class OrderCustomMissingItemDto
{
    public int Id { get; set; }
    public string ItemName { get; set; } = string.Empty;
    public int MissingQuantity { get; set; }
    public bool IsResolved { get; set; }
}
