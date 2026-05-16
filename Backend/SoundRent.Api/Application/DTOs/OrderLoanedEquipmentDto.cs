using System.ComponentModel.DataAnnotations;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class OrderLoanedEquipmentDto
{
    public int Id { get; set; }
    public LoanedEquipmentType LoanedEquipmentType { get; set; }
    public int Quantity { get; set; }

    [Range(0, int.MaxValue)]
    public int ExpectedNoteCount { get; set; }

    public List<LoanedEquipmentNoteDto> Notes { get; set; } = new();
}
