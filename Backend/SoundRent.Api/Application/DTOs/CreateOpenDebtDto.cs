using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class CreateOpenDebtDto
{
    [MaxLength(200)]
    public string? CustomerName { get; set; }

    [Required]
    [MaxLength(20)]
    public string Phone { get; set; } = string.Empty;

    [MaxLength(300)]
    public string? Address { get; set; }

    public DebtCategory Category { get; set; } = DebtCategory.Amplification;

    [MaxLength(300)]
    public string? ItemDescription { get; set; }

    [MaxLength(500)]
    public string? Deposit { get; set; }

    [Range(0.01, double.MaxValue)]
    public decimal Amount { get; set; }
}
