using SoundRent.Api.Application.DTOs;

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

    Task<InventoryDefinitionDto> ReplaceSerialsAsync(
        int id,
        InventoryDefinitionSerialsUpdateDto dto,
        CancellationToken cancellationToken = default);

    Task<List<InventoryDefinitionDto>> ReplaceSerialsBatchAsync(
        InventoryDefinitionBatchUpdateDto dto,
        CancellationToken cancellationToken = default);

    Task DeleteAsync(int id, CancellationToken cancellationToken = default);

    Task EnsureSystemTypesSeededAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns an existing catalog row by display name (case-insensitive), or creates a custom row with quantity 0.
    /// </summary>
    Task<InventoryDefinitionDto> EnsureByDisplayNameAsync(
        string displayName,
        CancellationToken cancellationToken = default);

    /// <summary>Ensures a serial exists on the catalog row and marks it Missing.</summary>
    Task MarkSerialMissingAsync(
        int inventoryDefinitionId,
        string serialCode,
        CancellationToken cancellationToken = default);

    /// <summary>Restores a catalog serial to InWarehouse when present.</summary>
    Task RestoreSerialAsync(
        int inventoryDefinitionId,
        string serialCode,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Validates serial codes on custom (unlinked) catalog loan lines:
    /// registered on the matching definition, unique, and not already loaned out.
    /// </summary>
    Task ValidateOrderCatalogSerialsAsync(
        IReadOnlyCollection<OrderLoanedEquipmentDto> items,
        int? excludeOrderId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Marks / releases <see cref="Domain.Entities.InventorySerialCode"/> rows for
    /// custom catalog loan lines (matched by display name).
    /// </summary>
    Task SyncCatalogSerialStatusForOrderAsync(
        IReadOnlyDictionary<string, HashSet<string>> priorAssignedByItemName,
        IReadOnlyCollection<OrderLoanedEquipmentDto> items,
        CancellationToken cancellationToken = default);

    /// <summary>Releases returned custom-catalog serials back to InWarehouse.</summary>
    Task ReleaseReturnedCatalogSerialsAsync(
        IReadOnlyCollection<(string ItemName, string SerialCode)> returnedCodes,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Marks custom-catalog serials as LoanedOut again (used when undoing a return).
    /// Throws if a code is already outstanding on another order.
    /// </summary>
    Task MarkCatalogSerialsLoanedOutAsync(
        IReadOnlyCollection<(string ItemName, string SerialCode)> codes,
        int? excludeOrderId,
        CancellationToken cancellationToken = default);

    /// <summary>Releases all non-returned custom-catalog serials assigned to an order.</summary>
    Task ReleaseAllOrderCatalogSerialsAsync(
        int orderId,
        CancellationToken cancellationToken = default);
}
