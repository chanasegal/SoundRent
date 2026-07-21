using SoundRent.Api.Application.DTOs;

namespace SoundRent.Api.Application.Services;

public interface IAccessorySerialInventoryService
{
    Task<List<AccessoryInventoryGroupDto>> GetAllGroupedAsync(CancellationToken cancellationToken = default);

    Task<AccessoryInventoryGroupDto> UpdateTypeAsync(
        Domain.Enums.LoanedEquipmentType equipmentType,
        AccessoryInventoryUpdateDto dto,
        CancellationToken cancellationToken = default);

    Task<List<AccessoryInventoryGroupDto>> UpdateAllAsync(
        AccessoryInventoryBatchUpdateDto dto,
        CancellationToken cancellationToken = default);

    Task<List<AccessorySerialAvailabilityGroupDto>> GetAvailabilityAsync(
        AccessorySerialAvailabilityRequestDto request,
        CancellationToken cancellationToken = default);

    Task<AccessorySerialLocationDto> GetSerialCodeLocationAsync(
        Domain.Enums.LoanedEquipmentType equipmentType,
        string serialCode,
        CancellationToken cancellationToken = default);

    Task ValidateOrderLoanedSerialsAsync(
        IReadOnlyCollection<OrderLoanedEquipmentDto> items,
        IReadOnlyCollection<OrderShiftDto> shifts,
        int? excludeOrderId,
        CancellationToken cancellationToken = default);

    Task SyncPhysicalStatusForOrderAsync(
        int orderId,
        IReadOnlyDictionary<Domain.Enums.LoanedEquipmentType, HashSet<string>> priorAssignedByType,
        IReadOnlyCollection<OrderLoanedEquipmentDto> items,
        CancellationToken cancellationToken = default);

    Task ReleaseReturnedSerialsAsync(
        IReadOnlyCollection<(Domain.Enums.LoanedEquipmentType EquipmentType, string SerialCode)> returnedCodes,
        CancellationToken cancellationToken = default);

    Task ReleaseAllOrderSerialsAsync(int orderId, CancellationToken cancellationToken = default);

    Task SetPhysicalStatusAsync(
        Domain.Enums.LoanedEquipmentType equipmentType,
        string serialCode,
        Domain.Enums.AccessorySerialPhysicalStatus status,
        CancellationToken cancellationToken = default);

    Task ValidateReturnedSerialGuardrailsAsync(
        int orderId,
        bool isReturnProcessed,
        IReadOnlyDictionary<Domain.Enums.LoanedEquipmentType, HashSet<string>> existingReturnedByType,
        IReadOnlyCollection<OrderLoanedEquipmentDto> incomingItems,
        CancellationToken cancellationToken = default);
}
