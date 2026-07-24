namespace SoundRent.Api.Application.DTOs;

/// <summary>
/// Active free-text (one-time) accessory loan that is not backed by an inventory catalog row.
/// </summary>
public class ActiveOneTimeAccessoryLoanDto
{
    public int OrderId { get; set; }

    public int LoanedEquipmentId { get; set; }

    /// <summary>Set when sourced from a manual unreturned report (no order line).</summary>
    public int? ManualItemId { get; set; }

    public string ItemName { get; set; } = string.Empty;

    public int Quantity { get; set; }

    public int OutstandingQuantity { get; set; }

    public string? CustomerName { get; set; }

    public string Phone { get; set; } = string.Empty;

    public string? Address { get; set; }

    /// <summary>Earliest order shift date (yyyy-MM-dd).</summary>
    public DateOnly? LoanDate { get; set; }

    /// <summary>Optional serial codes on the loan line (often empty for one-time items).</summary>
    public List<string> SerialCodes { get; set; } = [];
}
