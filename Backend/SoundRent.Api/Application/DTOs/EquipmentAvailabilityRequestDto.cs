using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class EquipmentAvailabilityRequestDto
{
    public List<OrderShiftDto> Shifts { get; set; } = [];

    /// <summary>
    /// When editing an order, exclude that order from occupancy checks.
    /// </summary>
    public int? ExcludeOrderId { get; set; }

    /// <summary>Optional product-system filter; defaults to Sound when omitted.</summary>
    public SystemType? SystemType { get; set; }
}
