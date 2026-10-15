using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class CashDepositDto
{
    public int Id { get; set; }
    public string CustomerName { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string? Address { get; set; }
    public decimal Amount { get; set; }
    public DateTime ReceivedAt { get; set; }
    public SystemType SourceModule { get; set; }
    public string SourceModuleLabel { get; set; } = string.Empty;
    public int? OrderId { get; set; }
    public int? ToolLoanId { get; set; }
    public int? BookLoanId { get; set; }

    /// <summary>Human-readable source reference, e.g. "הזמנה #120" / "השאלה #45".</summary>
    public string SourceReference { get; set; } = string.Empty;

    public CashDepositStatus Status { get; set; }
    public DateTime? ReturnedAt { get; set; }
    public string? Notes { get; set; }
}
