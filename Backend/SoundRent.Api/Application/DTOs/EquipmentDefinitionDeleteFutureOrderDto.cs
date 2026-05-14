namespace SoundRent.Api.Application.DTOs;

public sealed class EquipmentDefinitionDeleteFutureOrderDto
{
    public int OrderId { get; init; }

    public string? CustomerName { get; init; }

    public DateOnly OrderDate { get; init; }
}
