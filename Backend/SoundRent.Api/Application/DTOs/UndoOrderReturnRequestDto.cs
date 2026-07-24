namespace SoundRent.Api.Application.DTOs;

/// <summary>
/// Undo a previously recorded accessory return on an order line
/// (removes the entry from returns history and restores the active loan).
/// </summary>
public class UndoOrderReturnRequestDto
{
    public int LoanedEquipmentId { get; set; }

    /// <summary>Specific serial to un-return; omit for quantity-only lines.</summary>
    public string? SerialCode { get; set; }

    /// <summary>
    /// Units to undo on a quantity-only line. Defaults to the full returned quantity
    /// when omitted.
    /// </summary>
    public int? Quantity { get; set; }
}
