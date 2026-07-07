using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.DTOs;

public class UnreturnedItemDto
{
    public int OrderId { get; set; }
    public string? CustomerName { get; set; }
    public string Phone { get; set; } = string.Empty;
    public int LoanedEquipmentId { get; set; }
    public bool IsCustomItem { get; set; }
    public LoanedEquipmentType? LoanedEquipmentType { get; set; }
    public string EquipmentName { get; set; } = string.Empty;
    public DateOnly ReturnDate { get; set; }
    public int QuantityLoaned { get; set; }
    public int MissingQuantity { get; set; }
}
