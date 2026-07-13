namespace SoundRent.Api.Application.DTOs;

public class ToolDefinitionDto
{
    public int Id { get; set; }
    public string DisplayName { get; set; } = string.Empty;
    public int SortOrder { get; set; }
    public int TotalQuantity { get; set; }
    public List<string> SerialCodes { get; set; } = new();
}

public class ToolDefinitionCreateDto
{
    public string DisplayName { get; set; } = string.Empty;
    public int? Quantity { get; set; }
    public List<string>? SerialCodes { get; set; }
}

public class ToolDefinitionUpdateDto
{
    public string DisplayName { get; set; } = string.Empty;
}

public class ToolDefinitionSerialsUpdateDto
{
    public List<string> SerialCodes { get; set; } = new();
}

public class ToolDefinitionTypeUpdateDto
{
    public int Id { get; set; }
    public List<string> SerialCodes { get; set; } = new();
}

public class ToolDefinitionBatchUpdateDto
{
    public List<ToolDefinitionTypeUpdateDto> Items { get; set; } = new();
}

public class ToolSerialLocationDto
{
    public string SerialCode { get; set; } = string.Empty;
    public string ToolName { get; set; } = string.Empty;
    public int? ToolDefinitionId { get; set; }
    public bool IsRegistered { get; set; }
    public bool IsInWarehouse { get; set; }
    public int? LoanId { get; set; }
    public string? ClientName { get; set; }
    public string? Phone { get; set; }
}

public class ToolLoanItemDto
{
    public int Id { get; set; }
    public int ToolDefinitionId { get; set; }
    public string ToolName { get; set; } = string.Empty;
    public string SerialCode { get; set; } = string.Empty;
    public DateTime? ReturnedAt { get; set; }
    public string? HebrewReturnedDisplay { get; set; }
}

public class ToolLoanDto
{
    public int Id { get; set; }
    public DateTime LentAt { get; set; }
    public string HebrewLentDisplay { get; set; } = string.Empty;
    public string ClientName { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string? Deposit { get; set; }
    public string? Notes { get; set; }
    public DateTime? DeadlineAt { get; set; }
    public DateTime? ReturnedAt { get; set; }
    public string? HebrewReturnedDisplay { get; set; }
    public List<ToolLoanItemDto> Items { get; set; } = new();
}

public class ToolLoanItemCreateDto
{
    public int ToolDefinitionId { get; set; }
    public string SerialCode { get; set; } = string.Empty;
}

public class ToolLoanCreateDto
{
    public string ClientName { get; set; } = string.Empty;
    public string Phone { get; set; } = string.Empty;
    public string? Deposit { get; set; }
    public string? Notes { get; set; }
    public string HebrewLentDisplay { get; set; } = string.Empty;
    public DateTime? DeadlineAt { get; set; }
    public List<ToolLoanItemCreateDto> Items { get; set; } = new();
}

public class ToolLoanReturnDto
{
    public string HebrewReturnedDisplay { get; set; } = string.Empty;
}
