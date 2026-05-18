using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public sealed class OrderSlotConflictDto
{
    public int OrderId { get; init; }

    public string EquipmentDefinitionId { get; init; } = string.Empty;

    public string? EquipmentDisplayName { get; init; }

    public DateOnly OrderDate { get; init; }

    public TimeSlot TimeSlot { get; init; }
}
