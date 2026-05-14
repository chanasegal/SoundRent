namespace SoundRent.Api.Application.DTOs;

public sealed class EquipmentDefinitionDeleteBlockedResponseDto
{
    public string Message { get; init; } = string.Empty;

    public string Code { get; init; } = string.Empty;

    public IReadOnlyList<EquipmentDefinitionDeleteFutureOrderDto> FutureOrders { get; init; } =
        Array.Empty<EquipmentDefinitionDeleteFutureOrderDto>();
}
