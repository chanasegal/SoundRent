using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Infrastructure.Repositories;

public interface IAccessorySerialInventoryRepository
{
    Task<List<AccessorySerialInventory>> GetAllOrderedAsync(CancellationToken cancellationToken = default);

    Task ReplaceCodesForTypeAsync(
        LoanedEquipmentType equipmentType,
        IReadOnlyCollection<string> serialCodes,
        CancellationToken cancellationToken = default);

    /// <summary>Replaces serial codes for many types in one unit of work (single SaveChanges).</summary>
    Task ReplaceAllTypesAsync(
        IReadOnlyDictionary<LoanedEquipmentType, IReadOnlyCollection<string>> updatesByType,
        CancellationToken cancellationToken = default);

    /// <summary>One query for all booked serial codes grouped by accessory type.</summary>
    Task<Dictionary<LoanedEquipmentType, HashSet<string>>> GetBookedSerialCodesByTypesAsync(
        IReadOnlyCollection<DateOnly> dates,
        IReadOnlyCollection<OrderShiftDto>? shiftsFilter,
        int? excludeOrderId,
        CancellationToken cancellationToken = default);

    Task<HashSet<string>> GetBookedSerialCodesAsync(
        LoanedEquipmentType equipmentType,
        IReadOnlyCollection<DateOnly> dates,
        IReadOnlyCollection<OrderShiftDto>? shiftsFilter,
        int? excludeOrderId,
        CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
