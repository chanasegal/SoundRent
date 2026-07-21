using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Infrastructure.Repositories;

public sealed class AccessorySerialLocationQueryResult
{
    public LoanedEquipmentType EquipmentType { get; init; }

    public string SerialCode { get; init; } = string.Empty;

    public AccessorySerialPhysicalStatus PhysicalStatus { get; init; }

    public int? ActiveOrderId { get; init; }

    public string? CustomerName { get; init; }

    public string? Phone { get; init; }

    public string? Phone2 { get; init; }

    public string? Address { get; init; }

    public string? Deposit { get; init; }

    public string? Notes { get; init; }

    /// <summary>Earliest shift date on the active order, when loaned out.</summary>
    public DateOnly? LoanDate { get; init; }
}
