using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Domain.Entities;

/// <summary>Admin-configurable default number of &quot;פירוט&quot; inputs per loaned equipment type.</summary>
public class LoanedEquipmentTypeNoteDefault
{
    public LoanedEquipmentType LoanedEquipmentType { get; set; }

    public int DefaultNoteCount { get; set; }
}
