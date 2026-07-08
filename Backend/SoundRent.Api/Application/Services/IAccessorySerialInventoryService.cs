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

    Task ValidateOrderLoanedSerialsAsync(
        IReadOnlyCollection<OrderLoanedEquipmentDto> items,
        IReadOnlyCollection<OrderShiftDto> shifts,
        int? excludeOrderId,
        CancellationToken cancellationToken = default);
}
