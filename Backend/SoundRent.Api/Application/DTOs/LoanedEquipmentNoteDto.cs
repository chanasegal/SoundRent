using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Application.DTOs;

public class LoanedEquipmentNoteDto
{
    public int Id { get; set; }

    [Range(0, int.MaxValue)]
    public int Ordinal { get; set; }

    [MaxLength(100)]
    public string? Content { get; set; }
}
