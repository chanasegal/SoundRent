using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

/// <summary>
/// Flattened history row for a returned accessory (serial or quantity-only).
/// </summary>
public class ReturnedAccessoryHistoryDto
{
    public int? ManualItemId { get; set; }

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

    /// <summary>Earliest order shift date (calendar day for grouping).</summary>
    public DateOnly? LoanDate { get; set; }

    /// <summary>Best-available return/event calendar day (latest shift day or resolved day).</summary>
    public DateOnly? ReturnDate { get; set; }

    /// <summary>Full UTC borrow timestamp when known (preserves hours/minutes).</summary>
    public DateTime? LentAt { get; set; }

    /// <summary>Full UTC return timestamp when known (preserves hours/minutes).</summary>
    public DateTime? ReturnedAt { get; set; }

    public bool IsCustomItem { get; set; }

    /// <summary>True when the loan is tied to weekly-schedule main equipment.</summary>
    public bool IsOrderBased { get; set; }

    /// <summary>Order-level deposit type, when the source order recorded one.</summary>
    public DepositType? DepositType { get; set; }

    /// <summary>Order-level deposit holder name.</summary>
    public string? DepositOnName { get; set; }

    /// <summary>Cash deposit amount when DepositType is Cash.</summary>
    public decimal? CashDepositAmount { get; set; }

    /// <summary>True when the order's cash deposit was marked returned.</summary>
    public bool DepositReturned { get; set; }

    /// <summary>Order-level notes from the loan/order form.</summary>
    public string? Notes { get; set; }
}
