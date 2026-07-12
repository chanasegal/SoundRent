using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Application.DTOs;

public class UrgentBoardNoteUpdateDto
{
    [MaxLength(1000, ErrorMessage = "ההערה הדחופה לא יכולה לחרוג מ-1000 תווים")]
    public string? UrgentBoardNote { get; set; }
}
