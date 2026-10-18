using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Application.DTOs;

public class LoanedEquipmentNoteDto
{
    public int Id { get; set; }

    [Range(0, int.MaxValue)]
    public int Ordinal { get; set; }

    [MaxLength(100)]
    public string? Content { get; set; }

    public bool IsReturned { get; set; }

    /// <summary>UTC instant when this serial was marked returned; null while still out.</summary>
    public DateTime? ReturnedAt { get; set; }
}
