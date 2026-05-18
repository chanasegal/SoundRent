using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

/// <summary>
/// A requested date/shift reserved by an order.
/// </summary>
public class OrderShift
{
    public int OrderId { get; set; }
    public Order Order { get; set; } = null!;

    public DateOnly OrderDate { get; set; }

    public TimeSlot TimeSlot { get; set; }
}
