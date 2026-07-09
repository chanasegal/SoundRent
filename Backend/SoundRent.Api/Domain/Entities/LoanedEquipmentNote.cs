using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Domain.Entities;

public class LoanedEquipmentNote
{
    public int Id { get; set; }

    public int OrderLoanedEquipmentId { get; set; }
    public OrderLoanedEquipment OrderLoanedEquipment { get; set; } = null!;

    /// <summary>Zero-based index (#1 → 0, #2 → 1).</summary>
    public int Ordinal { get; set; }

    [MaxLength(100)]
    public string? Content { get; set; }

    /// <summary>When true, this assigned serial is checked back in and no longer blocks availability.</summary>
    public bool IsReturned { get; set; }
}
