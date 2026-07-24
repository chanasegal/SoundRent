namespace SoundRent.Api.Application.DTOs;

/// <summary>
/// Permanently removes a returned-accessory history entry from an order line
/// without restoring it as an active loan.
/// </summary>
public class DeleteReturnedAccessoryRequestDto
{
    public int LoanedEquipmentId { get; set; }

    /// <summary>Specific returned serial to erase; omit for quantity-only lines.</summary>
    public string? SerialCode { get; set; }

    /// <summary>
    /// Units to erase on a quantity-only returned line. Defaults to the full
    /// returned quantity when omitted.
    /// </summary>
    public int? Quantity { get; set; }
}
