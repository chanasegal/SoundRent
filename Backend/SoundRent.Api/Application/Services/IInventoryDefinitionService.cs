using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.Services;

public interface IInventoryDefinitionService
{
    Task<List<InventoryDefinitionDto>> GetAllAsync(CancellationToken cancellationToken = default);

    Task<InventoryDefinitionDto> CreateAsync(
        InventoryDefinitionCreateDto dto,
        CancellationToken cancellationToken = default);

    Task<InventoryDefinitionDto> UpdateAsync(
        int id,
        InventoryDefinitionUpdateDto dto,
        CancellationToken cancellationToken = default);

    Task<InventoryDefinitionDto> UpdateRowAsync(
        int id,
        InventoryDefinitionRowUpdateDto dto,
        CancellationToken cancellationToken = default);

    Task<InventoryDefinitionDto> ReplaceSerialsAsync(
        int id,
        InventoryDefinitionSerialsUpdateDto dto,
        CancellationToken cancellationToken = default);

    Task DeleteAsync(int id, CancellationToken cancellationToken = default);

    Task<InventoryDefinitionDto> EnsureByDisplayNameAsync(
        string displayName,
        CancellationToken cancellationToken = default);

    Task MarkSerialMissingAsync(
        int inventoryDefinitionId,
        string serialCode,
        CancellationToken cancellationToken = default);

    Task RestoreSerialAsync(
        int inventoryDefinitionId,
        string serialCode,
        CancellationToken cancellationToken = default);

    Task<InventoryDefinitionDto> SetSerialStatusAsync(
        int inventoryDefinitionId,
        string serialCode,
        AccessorySerialPhysicalStatus status,
        CancellationToken cancellationToken = default);

    Task ValidateOrderInventorySerialsAsync(
        IReadOnlyCollection<OrderLoanedEquipmentDto> items,
        int? excludeOrderId,
        CancellationToken cancellationToken = default);

    Task SyncInventorySerialStatusForOrderAsync(
        IReadOnlyDictionary<int, HashSet<string>> priorAssignedByDefinitionId,
        IReadOnlyCollection<OrderLoanedEquipmentDto> items,
        CancellationToken cancellationToken = default);

    Task ReleaseReturnedInventorySerialsAsync(
        IReadOnlyCollection<(int InventoryDefinitionId, string SerialCode)> returnedCodes,
        CancellationToken cancellationToken = default);

    Task MarkInventorySerialsLoanedOutAsync(
        IReadOnlyCollection<(int InventoryDefinitionId, string SerialCode)> codesToMark,
        int? excludeOrderId,
        CancellationToken cancellationToken = default);

    Task ReleaseAllOrderInventorySerialsAsync(
        int orderId,
        CancellationToken cancellationToken = default);

    Task<List<InventorySerialAvailabilityGroupDto>> GetAvailabilityAsync(
        InventorySerialAvailabilityRequestDto request,
        CancellationToken cancellationToken = default);

    Task<InventorySerialLocationDto> GetSerialLocationAsync(
        int inventoryDefinitionId,
        string serialCode,
        CancellationToken cancellationToken = default);

    Task SetPhysicalStatusAsync(
        int inventoryDefinitionId,
        string serialCode,
        AccessorySerialPhysicalStatus status,
        CancellationToken cancellationToken = default);
}
