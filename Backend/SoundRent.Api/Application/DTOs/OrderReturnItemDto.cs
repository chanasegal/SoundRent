using System.ComponentModel.DataAnnotations;

namespace SoundRent.Api.Application.DTOs;

public class OrderReturnItemDto
{
    public int LoanedEquipmentId { get; set; }

    [Range(0, int.MaxValue)]
    public int QuantityReturned { get; set; }

    public List<string> ReturnedSerialCodes { get; set; } = [];
}
