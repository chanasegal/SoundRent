using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Domain.Entities;

/// <summary>One borrowed tool unit on a <see cref="BookLoan"/>.</summary>
public class BookLoanItem
{
    public int Id { get; set; }

    public int BookLoanId { get; set; }

    public BookLoan BookLoan { get; set; } = null!;

    public int BookId { get; set; }

    [Required]
    [MaxLength(200)]
    public string BookTitle { get; set; } = string.Empty;

    [Required]
    [MaxLength(100)]
    public string CopyNumber { get; set; } = string.Empty;

    /// <summary>When set, this specific unit has been returned independently of sibling items.</summary>
    public DateTime? ReturnedAt { get; set; }

    [MaxLength(120)]
    public string? HebrewReturnedDisplay { get; set; }

    /// <summary>Charge amount recorded at return (null / 0 = no charge).</summary>
    public decimal? ChargeAmount { get; set; }

    /// <summary>Optional debt created when <see cref="ChargeAmount"/> &gt; 0.</summary>
    public CustomerDebt? CustomerDebt { get; set; }
}
