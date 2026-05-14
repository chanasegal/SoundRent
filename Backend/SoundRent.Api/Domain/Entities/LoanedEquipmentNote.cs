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
}
