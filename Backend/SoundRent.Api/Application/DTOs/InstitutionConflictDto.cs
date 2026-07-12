namespace SoundRent.Api.Application.DTOs;

public class InstitutionConflictDto
{
    public bool HasConflict { get; set; }

    public int? ConflictingOrderId { get; set; }

    public string? ConflictingCustomerName { get; set; }

    /// <summary>General notes from the conflicting order (institution reminder), if any.</summary>
    public string? InstitutionNote { get; set; }

    public DateOnly? ConflictDate { get; set; }
}
