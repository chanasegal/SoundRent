using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Domain.Entities;

/// <summary>Unit / serial code belonging to a <see cref="ToolDefinition"/>.</summary>
public class ToolSerialCode
{
    public int Id { get; set; }

    public int ToolDefinitionId { get; set; }

    public ToolDefinition ToolDefinition { get; set; } = null!;

    [Required]
    [MaxLength(100)]
    public string SerialCode { get; set; } = string.Empty;
}
