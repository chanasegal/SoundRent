using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Application.DTOs;

public class LoanedEquipmentTypeNoteDefaultUpdateDto
{
    [Range(0, 20)]
    public int DefaultNoteCount { get; set; }
}
