using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class OrderReturnItemDto
{
    [Required]
    public LoanedEquipmentType LoanedEquipmentType { get; set; }

    [Range(0, int.MaxValue)]
    public int QuantityReturned { get; set; }
}
