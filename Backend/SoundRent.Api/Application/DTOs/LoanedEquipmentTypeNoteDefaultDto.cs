using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class LoanedEquipmentTypeNoteDefaultDto
{
    public LoanedEquipmentType LoanedEquipmentType { get; set; }

    public int DefaultNoteCount { get; set; }
}
