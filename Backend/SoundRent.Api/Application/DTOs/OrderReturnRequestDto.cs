namespace SoundRent.Api.Application.DTOs;

public class OrderReturnRequestDto
{
    public List<OrderReturnItemDto> Items { get; set; } = new();
    public List<OrderCustomMissingItemInputDto> CustomMissingItems { get; set; } = new();
}
