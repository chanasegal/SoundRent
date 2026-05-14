using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

public class OrderLoanedEquipment
{
    public int Id { get; set; }

    public int OrderId { get; set; }
    public Order Order { get; set; } = null!;

    public LoanedEquipmentType LoanedEquipmentType { get; set; }

    public int Quantity { get; set; }

    /// <summary>How many detail note inputs apply to this line (UI + persisted notes).</summary>
    public int ExpectedNoteCount { get; set; }

    public ICollection<LoanedEquipmentNote> Notes { get; set; } = new List<LoanedEquipmentNote>();
}
