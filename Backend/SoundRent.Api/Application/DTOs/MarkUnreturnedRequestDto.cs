using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Application.DTOs;

public class MarkUnreturnedRequestDto
{
    [Required]
    [MinLength(1)]
    public List<MarkUnreturnedItemDto> Items { get; set; } = [];
}

public class MarkUnreturnedItemDto
{
    [Range(1, int.MaxValue)]
    public int LoanedEquipmentId { get; set; }

    [Range(1, int.MaxValue)]
    public int MissingQuantity { get; set; }

    /// <summary>
    /// Optional serial codes that did not return. When provided for a serialized line,
    /// these are marked not-returned and the rest are treated as returned.
    /// </summary>
    public List<string>? MissingSerialCodes { get; set; }
}
