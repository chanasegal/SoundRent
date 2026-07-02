namespace SoundRent.Api.Application.DTOs;

public class EquipmentAvailabilityRequestDto
{
    public List<OrderShiftDto> Shifts { get; set; } = [];

    /// <summary>
    /// When editing an order, exclude that order from occupancy checks.
    /// </summary>
    public int? ExcludeOrderId { get; set; }
}
