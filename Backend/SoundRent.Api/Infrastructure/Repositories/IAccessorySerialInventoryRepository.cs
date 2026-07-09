using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Infrastructure.Repositories;

public interface IAccessorySerialInventoryRepository
{
    Task<List<AccessorySerialInventory>> GetAllOrderedAsync(CancellationToken cancellationToken = default);

    /// <summary>Lightweight projection grouped by equipment type (optional filter).</summary>
    Task<Dictionary<LoanedEquipmentType, List<string>>> GetSerialCodesGroupedAsync(
        IReadOnlyCollection<LoanedEquipmentType>? typesFilter = null,
        CancellationToken cancellationToken = default);

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
        IReadOnlyCollection<LoanedEquipmentType>? typesFilter,
        int? excludeOrderId,
        CancellationToken cancellationToken = default);

    Task<HashSet<string>> GetBookedSerialCodesAsync(
        LoanedEquipmentType equipmentType,
        IReadOnlyCollection<DateOnly> dates,
        IReadOnlyCollection<OrderShiftDto>? shiftsFilter,
        int? excludeOrderId,
        CancellationToken cancellationToken = default);

    Task<Dictionary<LoanedEquipmentType, HashSet<string>>> GetLoanedOutCodesGroupedAsync(
        IReadOnlyCollection<LoanedEquipmentType>? typesFilter = null,
        CancellationToken cancellationToken = default);

    Task<Dictionary<LoanedEquipmentType, HashSet<string>>> GetAssignedCodesForOrderAsync(
        int orderId,
        IReadOnlyCollection<LoanedEquipmentType>? typesFilter = null,
        CancellationToken cancellationToken = default);

    Task<Dictionary<(LoanedEquipmentType Type, string Code), int>> GetActiveSerialOwnersAsync(
        int? excludeOrderId = null,
        CancellationToken cancellationToken = default);

    Task<AccessorySerialLocationQueryResult?> GetSerialCodeLocationAsync(
        LoanedEquipmentType equipmentType,
        string serialCode,
        CancellationToken cancellationToken = default);

    Task SetPhysicalStatusAsync(
        LoanedEquipmentType equipmentType,
        string serialCode,
        AccessorySerialPhysicalStatus status,
        CancellationToken cancellationToken = default);

    Task SaveChangesAsync(CancellationToken cancellationToken = default);
}
