namespace SoundRent.Api.Application.DTOs;

/// <summary>
/// Flattened history row for a returned Sound accessory (serial or quantity-only).
/// </summary>
public class ReturnedAccessoryHistoryDto
{
    public int OrderId { get; set; }

    public int LoanedEquipmentId { get; set; }

    public string ItemName { get; set; } = string.Empty;

    /// <summary>Assigned serial when the return was tracked per code; otherwise null.</summary>
    public string? SerialCode { get; set; }

    /// <summary>Units represented by this row (usually 1 for a serial).</summary>
    public int Quantity { get; set; }

    public string? CustomerName { get; set; }

    public string Phone { get; set; } = string.Empty;

    public string? Address { get; set; }

    /// <summary>Earliest order shift date.</summary>
    public DateOnly? LoanDate { get; set; }

    /// <summary>Best-available return/event date (latest shift day).</summary>
    public DateOnly? ReturnDate { get; set; }

    public bool IsCustomItem { get; set; }

    /// <summary>True when the loan is tied to weekly-schedule main equipment.</summary>
    public bool IsOrderBased { get; set; }
}
