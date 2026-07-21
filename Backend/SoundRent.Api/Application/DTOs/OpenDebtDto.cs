using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class OpenDebtGroupDto
{
    public string GroupKey { get; set; } = string.Empty;
    public string CustomerName { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public DebtCategory Category { get; set; }
    public string CategoryLabel { get; set; } = string.Empty;
    public decimal TotalAmount { get; set; }
    public string EquipmentSummary { get; set; } = string.Empty;
    public string? Deposit { get; set; }
    public DateTime SessionDate { get; set; }
    public List<int> DebtIds { get; set; } = new();
    public List<int> OrderIds { get; set; } = new();
}

public class MarkOpenDebtGroupPaidDto
{
    public List<int> DebtIds { get; set; } = new();
    public List<int> OrderIds { get; set; } = new();
}

public class CreatedOpenDebtDto
{
    public int DebtId { get; set; }
    public OpenDebtGroupDto Group { get; set; } = new();
}
