using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Mapping;
using SoundRent.Api.Application.Validation;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Application.Services;

public class InventoryDefinitionService : IInventoryDefinitionService
{
    private readonly IInventoryDefinitionRepository _repository;
    private readonly IAccessorySerialInventoryRepository _accessorySerials;
    private readonly AppDbContext _db;

    public InventoryDefinitionService(
        IInventoryDefinitionRepository repository,
        IAccessorySerialInventoryRepository accessorySerials,
        AppDbContext db)
    {
        _repository = repository;
        _accessorySerials = accessorySerials;
        _db = db;
    }

    public async Task EnsureSystemTypesSeededAsync(CancellationToken cancellationToken = default)
    {
        // Include inactive (soft-deleted) rows so deleted system types are not re-created on GetAll.
        var existingLinks = await _db.InventoryDefinitions
            .AsNoTracking()
            .Where(d => d.LinkedEquipmentType != null)
            .Select(d => d.LinkedEquipmentType!.Value)
            .ToListAsync(cancellationToken);

        var existingSet = existingLinks.ToHashSet();
        var toAdd = new List<InventoryDefinition>();

        foreach (LoanedEquipmentType type in Enum.GetValues<LoanedEquipmentType>())
        {
            if (existingSet.Contains(type))
            {
                continue;
            }

            var label = LoanedEquipmentTypeLabels.GetLabel(type);
            // Avoid unique DisplayName clash with a user-created custom row of the same name.
            var displayName = label;
            var suffix = 0;
            while (await _db.InventoryDefinitions.AnyAsync(
                       d => d.DisplayName == displayName,
                       cancellationToken))
            {
                suffix++;
                displayName = $"{label} ({suffix})";
            }

            toAdd.Add(new InventoryDefinition
            {
                DisplayName = displayName,
                SortOrder = (int)type,
                LinkedEquipmentType = type,
                IsActive = true,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
        }

        if (toAdd.Count == 0)
        {
            return;
        }

        foreach (var entity in toAdd)
        {
            await _repository.AddAsync(entity, cancellationToken);
        }

        await _repository.SaveChangesAsync(cancellationToken);
    }

    public async Task<List<InventoryDefinitionDto>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await EnsureSystemTypesSeededAsync(cancellationToken);

        var rows = await _repository.GetAllWithSerialsOrderedAsync(cancellationToken);
        var linkedTypes = rows
            .Where(r => r.LinkedEquipmentType is not null)
            .Select(r => r.LinkedEquipmentType!.Value)
            .Distinct()
            .ToList();

        var accessoryCodes = linkedTypes.Count == 0
            ? new Dictionary<LoanedEquipmentType, List<string>>()
            : await _accessorySerials.GetSerialCodesGroupedAsync(linkedTypes, cancellationToken);

        var accessoryStatuses = linkedTypes.Count == 0
            ? new Dictionary<(LoanedEquipmentType Type, string Code), AccessorySerialPhysicalStatus>()
            : await LoadAccessoryStatusesAsync(linkedTypes, cancellationToken);

        var missingByKey = await LoadUnresolvedMissingByKeyAsync(cancellationToken);
        var loanHolders = await LoadActiveLoanHoldersAsync(linkedTypes, cancellationToken);
        var catalogLoanHolders = await LoadActiveCatalogLoanHoldersAsync(cancellationToken);
        var missingByDefinition = await LoadUnresolvedMissingByDefinitionAsync(cancellationToken);

        return rows
            .Select(r => ToDto(
                r,
                accessoryCodes,
                accessoryStatuses,
                missingByKey,
                loanHolders,
                missingByDefinition,
                catalogLoanHolders))
            .ToList();
    }

    public async Task<InventoryDefinitionDto> CreateAsync(
        InventoryDefinitionCreateDto dto,
        CancellationToken cancellationToken = default)
    {
        var displayName = (dto.DisplayName ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(displayName))
        {
            throw new ValidationException("יש להזין שם פריט");
        }

        if (displayName.Length > 200)
        {
            throw new ValidationException("שם הפריט ארוך מדי");
        }

        if (await _repository.DisplayNameExistsAsync(displayName, excludeId: null, cancellationToken))
        {
            throw new ValidationException($"פריט בשם \"{displayName}\" כבר קיים במלאי");
        }

        // Soft-deleted system rows still occupy the unique display name.
        if (await _db.InventoryDefinitions.AnyAsync(
                d => !d.IsActive && d.DisplayName.ToLower() == displayName.ToLower() && d.LinkedEquipmentType != null,
                cancellationToken))
        {
            throw new ValidationException($"פריט בשם \"{displayName}\" כבר קיים במלאי");
        }

        var quantity = dto.Quantity is int q && q > 0 ? Math.Min(q, 200) : 0;
        var providedCodes = (dto.SerialCodes ?? [])
            .Select(c => (c ?? string.Empty).Trim())
            .Where(c => c.Length > 0)
            .ToList();

        // Custom catalog rows may track quantity only — do not auto-generate serial codes.
        List<string> codes;
        if (providedCodes.Count > 0)
        {
            var targetQty = Math.Max(quantity, providedCodes.Count);
            codes = BuildSerialCodes(targetQty, dto.SerialCodes);
            quantity = codes.Count;
        }
        else
        {
            codes = [];
        }

        // Reuse a soft-deleted custom row with the same display name (unique index still holds).
        var inactive = await _db.InventoryDefinitions
            .Include(d => d.SerialCodes)
            .FirstOrDefaultAsync(
                d => !d.IsActive
                    && d.LinkedEquipmentType == null
                    && d.DisplayName.ToLower() == displayName.ToLower(),
                cancellationToken);

        if (inactive is not null)
        {
            inactive.IsActive = true;
            inactive.Quantity = quantity;
            inactive.UpdatedAt = DateTime.UtcNow;
            ReplaceSerialCollection(inactive, codes);
            await _repository.SaveChangesAsync(cancellationToken);
            return ToDto(inactive, null);
        }

        var entity = new InventoryDefinition
        {
            DisplayName = displayName,
            SortOrder = await _repository.GetNextSortOrderAsync(cancellationToken),
            Quantity = quantity,
            LinkedEquipmentType = null,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            SerialCodes = codes
                .Select(code => new InventorySerialCode
                {
                    SerialCode = code,
                    PhysicalStatus = AccessorySerialPhysicalStatus.InWarehouse
                })
                .ToList()
        };

        await _repository.AddAsync(entity, cancellationToken);
        await _repository.SaveChangesAsync(cancellationToken);

        return ToDto(entity, null);
    }

    public async Task<InventoryDefinitionDto> EnsureByDisplayNameAsync(
        string displayName,
        CancellationToken cancellationToken = default)
    {
        var trimmed = (displayName ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            throw new ValidationException("יש להזין שם פריט");
        }

        if (trimmed.Length > 200)
        {
            throw new ValidationException("שם הפריט ארוך מדי");
        }

        var existing = await _repository.FindByDisplayNameAsync(trimmed, cancellationToken);
        if (existing is not null)
        {
            return ToDto(existing, null);
        }

        var inactive = await _db.InventoryDefinitions
            .Include(d => d.SerialCodes)
            .FirstOrDefaultAsync(
                d => !d.IsActive
                    && d.LinkedEquipmentType == null
                    && d.DisplayName.ToLower() == trimmed.ToLower(),
                cancellationToken);

        if (inactive is not null)
        {
            inactive.IsActive = true;
            inactive.UpdatedAt = DateTime.UtcNow;
            await _repository.SaveChangesAsync(cancellationToken);
            return ToDto(inactive, null);
        }

        var entity = new InventoryDefinition
        {
            DisplayName = trimmed,
            SortOrder = await _repository.GetNextSortOrderAsync(cancellationToken),
            Quantity = 0,
            LinkedEquipmentType = null,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            SerialCodes = []
        };

        await _repository.AddAsync(entity, cancellationToken);
        await _repository.SaveChangesAsync(cancellationToken);

        return ToDto(entity, null);
    }

    public async Task MarkSerialMissingAsync(
        int inventoryDefinitionId,
        string serialCode,
        CancellationToken cancellationToken = default)
    {
        var code = (serialCode ?? string.Empty).Trim();
        if (inventoryDefinitionId <= 0 || code.Length == 0)
        {
            return;
        }

        var entity = await _repository.GetByIdWithSerialsAsync(inventoryDefinitionId, cancellationToken)
            ?? throw new NotFoundException("פריט המלאי לא נמצא");

        if (entity.LinkedEquipmentType is LoanedEquipmentType linked)
        {
            await _accessorySerials.SetPhysicalStatusAsync(
                linked,
                code,
                AccessorySerialPhysicalStatus.Missing,
                cancellationToken);
            await _accessorySerials.SaveChangesAsync(cancellationToken);
            return;
        }

        var existing = entity.SerialCodes.FirstOrDefault(s =>
            string.Equals(s.SerialCode, code, StringComparison.OrdinalIgnoreCase));
        if (existing is null)
        {
            entity.SerialCodes.Add(new InventorySerialCode
            {
                SerialCode = code,
                PhysicalStatus = AccessorySerialPhysicalStatus.Missing
            });
        }
        else
        {
            existing.PhysicalStatus = AccessorySerialPhysicalStatus.Missing;
        }

        entity.UpdatedAt = DateTime.UtcNow;
        await _repository.SaveChangesAsync(cancellationToken);
    }

    public async Task RestoreSerialAsync(
        int inventoryDefinitionId,
        string serialCode,
        CancellationToken cancellationToken = default)
    {
        var code = (serialCode ?? string.Empty).Trim();
        if (inventoryDefinitionId <= 0 || code.Length == 0)
        {
            return;
        }

        var entity = await _repository.GetByIdWithSerialsAsync(inventoryDefinitionId, cancellationToken);
        if (entity is null)
        {
            return;
        }

        if (entity.LinkedEquipmentType is LoanedEquipmentType linked)
        {
            await _accessorySerials.SetPhysicalStatusAsync(
                linked,
                code,
                AccessorySerialPhysicalStatus.InWarehouse,
                cancellationToken);
            await _accessorySerials.SaveChangesAsync(cancellationToken);
            return;
        }

        var existing = entity.SerialCodes.FirstOrDefault(s =>
            string.Equals(s.SerialCode, code, StringComparison.OrdinalIgnoreCase));
        if (existing is null)
        {
            return;
        }

        existing.PhysicalStatus = AccessorySerialPhysicalStatus.InWarehouse;
        entity.UpdatedAt = DateTime.UtcNow;
        await _repository.SaveChangesAsync(cancellationToken);
    }

    public async Task ValidateOrderCatalogSerialsAsync(
        IReadOnlyCollection<OrderLoanedEquipmentDto> items,
        int? excludeOrderId,
        CancellationToken cancellationToken = default)
    {
        var customItems = (items ?? [])
            .Where(i => i.IsCustomItem && i.Quantity > 0 && !string.IsNullOrWhiteSpace(i.CustomItemName))
            .ToList();
        if (customItems.Count == 0)
        {
            return;
        }

        var names = customItems
            .Select(i => i.CustomItemName!.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var definitions = await LoadUnlinkedDefinitionsByNamesAsync(names, tracked: false, cancellationToken);
        if (definitions.Count == 0)
        {
            return;
        }

        var reservedByName = excludeOrderId is int orderId
            ? await GetAssignedCatalogCodesForOrderAsync(orderId, cancellationToken)
            : new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);

        var activeByName = await GetActiveCatalogAssignedCodesAsync(excludeOrderId, cancellationToken);

        foreach (var item in customItems)
        {
            var name = item.CustomItemName!.Trim();
            if (!definitions.TryGetValue(name, out var def) || def.SerialCodes.Count == 0)
            {
                continue;
            }

            var allowedCodes = def.SerialCodes
                .Select(s => s.SerialCode.Trim())
                .Where(c => c.Length > 0)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var statusByCode = def.SerialCodes
                .Where(s => (s.SerialCode ?? string.Empty).Trim().Length > 0)
                .ToDictionary(
                    s => s.SerialCode.Trim(),
                    s => s.PhysicalStatus,
                    StringComparer.OrdinalIgnoreCase);

            var selectedCodes = (item.Notes ?? [])
                .OrderBy(n => n.Ordinal)
                .Select(n => new
                {
                    Code = (n.Content ?? string.Empty).Trim(),
                    n.IsReturned
                })
                .Where(n => n.Code.Length > 0)
                .ToList();

            if (selectedCodes.Count > 0 && selectedCodes.Count != item.Quantity)
            {
                throw new ValidationException($"יש לבחור קוד לכל יחידה עבור \"{name}\"");
            }

            if (selectedCodes.Select(n => n.Code).Distinct(StringComparer.OrdinalIgnoreCase).Count()
                != selectedCodes.Count)
            {
                throw new ValidationException($"לא ניתן לבחור את אותו קוד פעמיים עבור \"{name}\"");
            }

            reservedByName.TryGetValue(name, out var reserved);
            reserved ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            activeByName.TryGetValue(name, out var active);
            active ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var entry in selectedCodes)
            {
                if (!allowedCodes.Contains(entry.Code))
                {
                    throw new ValidationException($"הקוד \"{entry.Code}\" אינו רשום במלאי עבור \"{name}\"");
                }

                if (entry.IsReturned)
                {
                    continue;
                }

                var unavailableByStatus =
                    statusByCode.TryGetValue(entry.Code, out var status)
                    && status is AccessorySerialPhysicalStatus.LoanedOut
                        or AccessorySerialPhysicalStatus.Missing;
                var unavailableByActiveLoan = active.Contains(entry.Code);

                if ((unavailableByStatus || unavailableByActiveLoan) && !reserved.Contains(entry.Code))
                {
                    throw new ValidationException(
                        $"הקוד \"{entry.Code}\" כרגע בחוץ (מושאל) ואינו זמין לבחירה ({name})");
                }
            }
        }
    }

    public async Task SyncCatalogSerialStatusForOrderAsync(
        IReadOnlyDictionary<string, HashSet<string>> priorAssignedByItemName,
        IReadOnlyCollection<OrderLoanedEquipmentDto> items,
        CancellationToken cancellationToken = default)
    {
        var prior = priorAssignedByItemName ?? new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        var next = ExtractAssignedCatalogCodesByName(items);
        var allNames = prior.Keys
            .Concat(next.Keys)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (allNames.Count == 0)
        {
            return;
        }

        var definitions = await LoadUnlinkedDefinitionsByNamesAsync(allNames, tracked: true, cancellationToken);
        if (definitions.Count == 0)
        {
            return;
        }

        var changed = false;
        foreach (var name in allNames)
        {
            if (!definitions.TryGetValue(name, out var def))
            {
                continue;
            }

            prior.TryGetValue(name, out var priorCodes);
            priorCodes ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            next.TryGetValue(name, out var nextCodes);
            nextCodes ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var code in priorCodes.Except(nextCodes, StringComparer.OrdinalIgnoreCase))
            {
                if (SetCatalogSerialStatus(def, code, AccessorySerialPhysicalStatus.InWarehouse))
                {
                    changed = true;
                }
            }

            foreach (var code in nextCodes.Except(priorCodes, StringComparer.OrdinalIgnoreCase))
            {
                if (SetCatalogSerialStatus(def, code, AccessorySerialPhysicalStatus.LoanedOut))
                {
                    changed = true;
                }
            }
        }

        if (changed)
        {
            await _repository.SaveChangesAsync(cancellationToken);
        }
    }

    public async Task ReleaseReturnedCatalogSerialsAsync(
        IReadOnlyCollection<(string ItemName, string SerialCode)> returnedCodes,
        CancellationToken cancellationToken = default)
    {
        if (returnedCodes is null || returnedCodes.Count == 0)
        {
            return;
        }

        var byName = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var (itemName, serialCode) in returnedCodes)
        {
            var name = (itemName ?? string.Empty).Trim();
            var code = (serialCode ?? string.Empty).Trim();
            if (name.Length == 0 || code.Length == 0)
            {
                continue;
            }

            if (!byName.TryGetValue(name, out var codes))
            {
                codes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                byName[name] = codes;
            }

            codes.Add(code);
        }

        if (byName.Count == 0)
        {
            return;
        }

        var definitions = await LoadUnlinkedDefinitionsByNamesAsync(byName.Keys.ToList(), tracked: true, cancellationToken);
        var changed = false;
        foreach (var (name, codes) in byName)
        {
            if (!definitions.TryGetValue(name, out var def))
            {
                continue;
            }

            foreach (var code in codes)
            {
                if (SetCatalogSerialStatus(def, code, AccessorySerialPhysicalStatus.InWarehouse))
                {
                    changed = true;
                }
            }
        }

        if (changed)
        {
            await _repository.SaveChangesAsync(cancellationToken);
        }
    }

    public async Task MarkCatalogSerialsLoanedOutAsync(
        IReadOnlyCollection<(string ItemName, string SerialCode)> codesToMark,
        int? excludeOrderId,
        CancellationToken cancellationToken = default)
    {
        if (codesToMark is null || codesToMark.Count == 0)
        {
            return;
        }

        var byName = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var (itemName, serialCode) in codesToMark)
        {
            var name = (itemName ?? string.Empty).Trim();
            var code = (serialCode ?? string.Empty).Trim();
            if (name.Length == 0 || code.Length == 0)
            {
                continue;
            }

            if (!byName.TryGetValue(name, out var codes))
            {
                codes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                byName[name] = codes;
            }

            codes.Add(code);
        }

        if (byName.Count == 0)
        {
            return;
        }

        var activeByName = await GetActiveCatalogAssignedCodesAsync(excludeOrderId, cancellationToken);
        foreach (var (name, codes) in byName)
        {
            if (!activeByName.TryGetValue(name, out var active) || active.Count == 0)
            {
                continue;
            }

            foreach (var code in codes)
            {
                if (active.Contains(code))
                {
                    throw new ValidationException(
                        $"לא ניתן לבטל החזרה — קוד {code} כבר מושאל בהשאלה אחרת ({name})");
                }
            }
        }

        var definitions = await LoadUnlinkedDefinitionsByNamesAsync(byName.Keys.ToList(), tracked: true, cancellationToken);
        var changed = false;
        foreach (var (name, codes) in byName)
        {
            if (!definitions.TryGetValue(name, out var def))
            {
                continue;
            }

            foreach (var code in codes)
            {
                if (SetCatalogSerialStatus(def, code, AccessorySerialPhysicalStatus.LoanedOut))
                {
                    changed = true;
                }
            }
        }

        if (changed)
        {
            await _repository.SaveChangesAsync(cancellationToken);
        }
    }

    public async Task ReleaseAllOrderCatalogSerialsAsync(
        int orderId,
        CancellationToken cancellationToken = default)
    {
        var assigned = await GetAssignedCatalogCodesForOrderAsync(orderId, cancellationToken);
        if (assigned.Count == 0)
        {
            return;
        }

        var returned = assigned
            .SelectMany(kv => kv.Value.Select(code => (ItemName: kv.Key, SerialCode: code)))
            .ToList();
        await ReleaseReturnedCatalogSerialsAsync(returned, cancellationToken);
    }

    public async Task<InventoryDefinitionDto> UpdateAsync(
        int id,
        InventoryDefinitionUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await _repository.GetByIdWithSerialsAsync(id, cancellationToken)
            ?? throw new NotFoundException("פריט המלאי לא נמצא");

        var displayName = (dto.DisplayName ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(displayName))
        {
            throw new ValidationException("יש להזין שם פריט");
        }

        if (displayName.Length > 200)
        {
            throw new ValidationException("שם הפריט ארוך מדי");
        }

        if (await _repository.DisplayNameExistsAsync(displayName, excludeId: id, cancellationToken))
        {
            throw new ValidationException($"פריט בשם \"{displayName}\" כבר קיים במלאי");
        }

        entity.DisplayName = displayName;
        entity.UpdatedAt = DateTime.UtcNow;
        await _repository.SaveChangesAsync(cancellationToken);
        return await ToDtoAsync(entity, cancellationToken);
    }

    public async Task<InventoryDefinitionDto> ReplaceSerialsAsync(
        int id,
        InventoryDefinitionSerialsUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await _repository.GetByIdWithSerialsAsync(id, cancellationToken)
            ?? throw new NotFoundException("פריט המלאי לא נמצא");

        var codes = NormalizeExplicitCodes(dto.SerialCodes, entity.LinkedEquipmentType);
        await PersistSerialsAsync(entity, codes, cancellationToken);
        entity.Quantity = entity.LinkedEquipmentType is not null
            ? codes.Count
            : Math.Max(entity.Quantity, codes.Count);
        entity.UpdatedAt = DateTime.UtcNow;
        await _repository.SaveChangesAsync(cancellationToken);
        return await ToDtoAsync(entity, cancellationToken);
    }

    public async Task<List<InventoryDefinitionDto>> ReplaceSerialsBatchAsync(
        InventoryDefinitionBatchUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        var results = new List<InventoryDefinitionDto>();
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            foreach (var item in dto.Items ?? [])
            {
                var entity = await _repository.GetByIdWithSerialsAsync(item.Id, cancellationToken)
                    ?? throw new NotFoundException($"פריט המלאי #{item.Id} לא נמצא");

                var codes = NormalizeExplicitCodes(item.SerialCodes, entity.LinkedEquipmentType);
                await PersistSerialsAsync(entity, codes, cancellationToken);

                if (entity.LinkedEquipmentType is not null)
                {
                    entity.Quantity = codes.Count;
                }
                else if (item.Quantity is int qty)
                {
                    entity.Quantity = Math.Max(0, Math.Min(200, qty));
                }
                else
                {
                    // Keep at least the explicit serial count when quantity omitted.
                    entity.Quantity = Math.Max(entity.Quantity, codes.Count);
                }

                entity.UpdatedAt = DateTime.UtcNow;
                results.Add(await ToDtoAsync(entity, cancellationToken));
            }

            await _repository.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }

        return results.OrderBy(r => r.SortOrder).ThenBy(r => r.Id).ToList();
    }

    public async Task DeleteAsync(int id, CancellationToken cancellationToken = default)
    {
        var entity = await _db.InventoryDefinitions
            .Include(d => d.SerialCodes)
            .FirstOrDefaultAsync(d => d.Id == id, cancellationToken)
            ?? throw new NotFoundException("פריט המלאי לא נמצא");

        if (!entity.IsActive)
        {
            return;
        }

        // Soft-delete so EnsureSystemTypesSeededAsync does not recreate linked system rows on GetAll.
        entity.IsActive = false;
        entity.UpdatedAt = DateTime.UtcNow;

        if (entity.LinkedEquipmentType is LoanedEquipmentType linked)
        {
            await _accessorySerials.ReplaceCodesForTypeAsync(linked, Array.Empty<string>(), cancellationToken);
        }

        // Drop default-accessory links that would otherwise keep pointing at a removed catalog row.
        var defaultAccessories = await _db.EquipmentDefaultAccessories
            .Where(a => a.InventoryDefinitionId == id)
            .ToListAsync(cancellationToken);
        if (defaultAccessories.Count > 0)
        {
            _db.EquipmentDefaultAccessories.RemoveRange(defaultAccessories);
        }

        await _repository.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// Builds exactly <paramref name="quantity"/> codes. Blank slots get sequential numeric fallbacks.
    /// </summary>
    internal static List<string> BuildSerialCodes(int quantity, IEnumerable<string>? rawCodes)
    {
        if (quantity <= 0)
        {
            return [];
        }

        var provided = (rawCodes ?? []).Take(quantity).Select(c => (c ?? string.Empty).Trim()).ToList();
        while (provided.Count < quantity)
        {
            provided.Add(string.Empty);
        }

        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var result = new List<string>(quantity);
        var next = 1;

        foreach (var raw in provided)
        {
            string code;
            if (raw.Length > 0)
            {
                if (raw.Length > 100)
                {
                    throw new ValidationException($"קוד פריט ארוך מדי: {raw}");
                }

                if (!used.Add(raw))
                {
                    throw new ValidationException($"קוד פריט כפול: {raw}");
                }

                code = raw;
            }
            else
            {
                while (!used.Add(next.ToString()))
                {
                    next++;
                }

                code = next.ToString();
                next++;
            }

            result.Add(code);
        }

        return result;
    }

    private async Task PersistSerialsAsync(
        InventoryDefinition entity,
        List<string> codes,
        CancellationToken cancellationToken)
    {
        if (entity.LinkedEquipmentType is LoanedEquipmentType linked)
        {
            // Linked system types keep loan-compatible codes in AccessorySerialInventory.
            entity.SerialCodes.Clear();
            await _accessorySerials.ReplaceCodesForTypeAsync(linked, codes, cancellationToken);
            return;
        }

        ReplaceSerialCollection(entity, codes);
    }

    private static List<string> NormalizeExplicitCodes(
        IEnumerable<string>? rawCodes,
        LoanedEquipmentType? linkedType)
    {
        var result = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var raw in rawCodes ?? [])
        {
            var trimmed = (raw ?? string.Empty).Trim();
            if (trimmed.Length == 0)
            {
                continue;
            }

            if (trimmed.Length > 100)
            {
                throw new ValidationException($"קוד פריט ארוך מדי: {trimmed}");
            }

            if (linkedType is LoanedEquipmentType type && !AccessorySerialCodeValidator.IsValid(type, trimmed))
            {
                throw new ValidationException(AccessorySerialCodeValidator.InvalidMessageFor(type));
            }

            if (!seen.Add(trimmed))
            {
                throw new ValidationException($"קוד פריט כפול: {trimmed}");
            }

            result.Add(trimmed);
        }

        return result;
    }

    private static void ReplaceSerialCollection(InventoryDefinition entity, List<string> codes)
    {
        var priorStatus = entity.SerialCodes
            .Where(s => (s.SerialCode ?? string.Empty).Trim().Length > 0)
            .GroupBy(s => s.SerialCode.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                g => g.Key,
                g => g.First().PhysicalStatus,
                StringComparer.OrdinalIgnoreCase);

        entity.SerialCodes.Clear();
        foreach (var code in codes)
        {
            entity.SerialCodes.Add(new InventorySerialCode
            {
                SerialCode = code,
                PhysicalStatus = priorStatus.TryGetValue(code, out var status)
                    ? status
                    : AccessorySerialPhysicalStatus.InWarehouse
            });
        }
    }

    private async Task<InventoryDefinitionDto> ToDtoAsync(
        InventoryDefinition entity,
        CancellationToken cancellationToken)
    {
        Dictionary<LoanedEquipmentType, List<string>>? accessoryCodes = null;
        Dictionary<(LoanedEquipmentType Type, string Code), AccessorySerialPhysicalStatus>? accessoryStatuses = null;
        Dictionary<(LoanedEquipmentType Type, string Code), InventoryHolderDto>? loanHolders = null;
        if (entity.LinkedEquipmentType is LoanedEquipmentType linked)
        {
            accessoryCodes = await _accessorySerials.GetSerialCodesGroupedAsync([linked], cancellationToken);
            accessoryStatuses = await LoadAccessoryStatusesAsync([linked], cancellationToken);
            loanHolders = await LoadActiveLoanHoldersAsync([linked], cancellationToken);
        }

        var missingByKey = await LoadUnresolvedMissingByKeyAsync(cancellationToken);
        var missingByDefinition = await LoadUnresolvedMissingByDefinitionAsync(cancellationToken);
        var catalogLoanHolders = entity.LinkedEquipmentType is null
            ? await LoadActiveCatalogLoanHoldersAsync(cancellationToken)
            : null;
        return ToDto(
            entity,
            accessoryCodes,
            accessoryStatuses,
            missingByKey,
            loanHolders,
            missingByDefinition,
            catalogLoanHolders);
    }

    private async Task<Dictionary<(LoanedEquipmentType Type, string Code), AccessorySerialPhysicalStatus>>
        LoadAccessoryStatusesAsync(
            IReadOnlyCollection<LoanedEquipmentType> types,
            CancellationToken cancellationToken)
    {
        var typeList = types.Distinct().ToList();
        var rows = await _db.AccessorySerialInventory
            .AsNoTracking()
            .Where(r => typeList.Contains(r.EquipmentType))
            .Select(r => new { r.EquipmentType, r.SerialCode, r.PhysicalStatus })
            .ToListAsync(cancellationToken);

        var result = new Dictionary<(LoanedEquipmentType Type, string Code), AccessorySerialPhysicalStatus>();
        foreach (var row in rows)
        {
            var code = (row.SerialCode ?? string.Empty).Trim();
            if (code.Length == 0)
            {
                continue;
            }

            result[(row.EquipmentType, code)] = row.PhysicalStatus;
        }

        return result;
    }

    private async Task<Dictionary<(LoanedEquipmentType Type, string Code), InventoryHolderDto>>
        LoadActiveLoanHoldersAsync(
            IReadOnlyCollection<LoanedEquipmentType> types,
            CancellationToken cancellationToken)
    {
        var result = new Dictionary<(LoanedEquipmentType Type, string Code), InventoryHolderDto>();
        if (types.Count == 0)
        {
            return result;
        }

        var typeList = types.Distinct().ToList();
        var rows = await (
            from le in _db.OrderLoanedEquipments.AsNoTracking()
            join order in _db.Orders.AsNoTracking() on le.OrderId equals order.Id
            join note in _db.LoanedEquipmentNotes.AsNoTracking() on le.Id equals note.OrderLoanedEquipmentId
            where !order.IsCancelled
                  && !le.IsCustomItem
                  && le.LoanedEquipmentType != null
                  && typeList.Contains(le.LoanedEquipmentType.Value)
                  && note.Content != null
                  && note.Content != ""
                  && !note.IsReturned
            select new
            {
                Type = le.LoanedEquipmentType!.Value,
                Code = note.Content!,
                order.Id,
                order.CustomerName,
                order.Phone,
                order.Address,
                LoanDate = _db.OrderShifts
                    .Where(s => s.OrderId == order.Id)
                    .OrderBy(s => s.OrderDate)
                    .Select(s => (DateOnly?)s.OrderDate)
                    .FirstOrDefault()
            }).ToListAsync(cancellationToken);

        foreach (var row in rows)
        {
            var code = row.Code.Trim();
            if (code.Length == 0)
            {
                continue;
            }

            result.TryAdd((row.Type, code), new InventoryHolderDto
            {
                SerialCode = code,
                Status = AccessorySerialPhysicalStatus.LoanedOut,
                StatusLabel = AggregateStatusLabel(AccessorySerialPhysicalStatus.LoanedOut),
                CustomerName = row.CustomerName,
                Phone = row.Phone,
                Address = row.Address,
                EventDate = row.LoanDate,
                OrderId = row.Id
            });
        }

        return result;
    }

    private async Task<Dictionary<string, ManualUnreturnedItem>> LoadUnresolvedMissingByKeyAsync(
        CancellationToken cancellationToken)
    {
        var rows = await _db.ManualUnreturnedItems
            .AsNoTracking()
            .Where(m => !m.IsResolved)
            .OrderByDescending(m => m.CreatedAt)
            .ToListAsync(cancellationToken);

        var result = new Dictionary<string, ManualUnreturnedItem>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in rows)
        {
            var code = (row.ItemCode ?? string.Empty).Trim();
            if (code.Length == 0)
            {
                continue;
            }

            var key = BuildMissingKey(row.InventoryDefinitionId, row.LoanedEquipmentType, code);
            result.TryAdd(key, row);
            result.TryAdd($"code:{code}", row);
        }

        return result;
    }

    private async Task<Dictionary<int, List<ManualUnreturnedItem>>> LoadUnresolvedMissingByDefinitionAsync(
        CancellationToken cancellationToken)
    {
        var rows = await _db.ManualUnreturnedItems
            .AsNoTracking()
            .Where(m => !m.IsResolved && m.InventoryDefinitionId != null)
            .OrderByDescending(m => m.CreatedAt)
            .ToListAsync(cancellationToken);

        return rows
            .GroupBy(m => m.InventoryDefinitionId!.Value)
            .ToDictionary(g => g.Key, g => g.ToList());
    }

    private static string BuildMissingKey(
        int? inventoryDefinitionId,
        LoanedEquipmentType? linkedType,
        string code)
    {
        if (inventoryDefinitionId is > 0)
        {
            return $"def:{inventoryDefinitionId}:{code}";
        }

        if (linkedType.HasValue)
        {
            return $"type:{linkedType.Value}:{code}";
        }

        return $"code:{code}";
    }

    private static InventoryDefinitionDto ToDto(
        InventoryDefinition entity,
        IReadOnlyDictionary<LoanedEquipmentType, List<string>>? accessoryCodes,
        IReadOnlyDictionary<(LoanedEquipmentType Type, string Code), AccessorySerialPhysicalStatus>? accessoryStatuses = null,
        IReadOnlyDictionary<string, ManualUnreturnedItem>? missingByKey = null,
        IReadOnlyDictionary<(LoanedEquipmentType Type, string Code), InventoryHolderDto>? loanHolders = null,
        IReadOnlyDictionary<int, List<ManualUnreturnedItem>>? missingByDefinition = null,
        IReadOnlyDictionary<string, Dictionary<string, InventoryHolderDto>>? catalogLoanHolders = null)
    {
        List<string> codes;
        List<InventorySerialUnitDto> units;
        var holders = new List<InventoryHolderDto>();

        if (entity.LinkedEquipmentType is LoanedEquipmentType linked
            && accessoryCodes is not null
            && accessoryCodes.TryGetValue(linked, out var fromAccessory))
        {
            codes = fromAccessory;
            units = codes.Select(code =>
            {
                var status = AccessorySerialPhysicalStatus.InWarehouse;
                if (accessoryStatuses is not null
                    && accessoryStatuses.TryGetValue((linked, code), out var fromStatus))
                {
                    status = fromStatus;
                }

                ManualUnreturnedItem? missing = null;
                InventoryHolderDto? loan = null;
                if (status == AccessorySerialPhysicalStatus.Missing && missingByKey is not null)
                {
                    missingByKey.TryGetValue(BuildMissingKey(entity.Id, linked, code), out missing);
                    missing ??= missingByKey.GetValueOrDefault($"code:{code}");
                }
                else if (status == AccessorySerialPhysicalStatus.LoanedOut && loanHolders is not null)
                {
                    loanHolders.TryGetValue((linked, code), out loan);
                }

                var unit = BuildSerialUnit(code, status, missing, loan);
                if (status is AccessorySerialPhysicalStatus.Missing or AccessorySerialPhysicalStatus.LoanedOut)
                {
                    holders.Add(ToHolder(unit, loan?.OrderId));
                }

                return unit;
            }).ToList();
        }
        else
        {
            codes = entity.SerialCodes
                .OrderBy(s => s.Id)
                .Select(s => s.SerialCode)
                .ToList();
            units = entity.SerialCodes
                .OrderBy(s => s.Id)
                .Select(s =>
                {
                    var code = s.SerialCode;
                    var status = s.PhysicalStatus;
                    ManualUnreturnedItem? missing = null;
                    InventoryHolderDto? loan = null;
                    if (status == AccessorySerialPhysicalStatus.Missing && missingByKey is not null)
                    {
                        missingByKey.TryGetValue(BuildMissingKey(entity.Id, null, code), out missing);
                        missing ??= missingByKey.GetValueOrDefault($"code:{code}");
                    }
                    else if (missingByKey is not null
                             && missingByKey.TryGetValue(BuildMissingKey(entity.Id, null, code), out var byDef))
                    {
                        status = AccessorySerialPhysicalStatus.Missing;
                        missing = byDef;
                    }
                    else if (status != AccessorySerialPhysicalStatus.Missing
                             && catalogLoanHolders is not null
                             && TryGetCatalogLoan(catalogLoanHolders, entity.DisplayName, code, out loan))
                    {
                        status = AccessorySerialPhysicalStatus.LoanedOut;
                    }

                    var unit = BuildSerialUnit(code, status, missing, loan);
                    if (status is AccessorySerialPhysicalStatus.Missing or AccessorySerialPhysicalStatus.LoanedOut)
                    {
                        holders.Add(ToHolder(unit, loan?.OrderId));
                    }

                    return unit;
                })
                .ToList();
        }

        // Quantity-only missing rows (no serial code) still surface as holders.
        if (missingByDefinition is not null
            && missingByDefinition.TryGetValue(entity.Id, out var defMissing))
        {
            foreach (var missing in defMissing)
            {
                var code = (missing.ItemCode ?? string.Empty).Trim();
                if (code.Length > 0
                    && holders.Any(h =>
                        string.Equals(h.SerialCode, code, StringComparison.OrdinalIgnoreCase)))
                {
                    continue;
                }

                holders.Add(new InventoryHolderDto
                {
                    SerialCode = code.Length > 0 ? code : null,
                    Status = AccessorySerialPhysicalStatus.Missing,
                    StatusLabel = AggregateStatusLabel(AccessorySerialPhysicalStatus.Missing),
                    CustomerName = missing.CustomerName,
                    Phone = missing.Phone,
                    Address = missing.Address,
                    EventDate = DateOnly.FromDateTime(missing.CreatedAt.ToUniversalTime())
                });
            }
        }

        var aggregate = ResolveAggregateStatus(units, holders);
        var totalQuantity = entity.LinkedEquipmentType is not null
            ? codes.Count
            : Math.Max(entity.Quantity, codes.Count);

        return new InventoryDefinitionDto
        {
            Id = entity.Id,
            DisplayName = entity.DisplayName,
            SortOrder = entity.SortOrder,
            TotalQuantity = totalQuantity,
            SerialCodes = codes,
            SerialUnits = units,
            AggregateStatus = aggregate,
            AggregateStatusLabel = AggregateStatusLabel(aggregate),
            ActiveHolders = holders,
            LinkedEquipmentType = entity.LinkedEquipmentType
        };
    }

    private static AccessorySerialPhysicalStatus ResolveAggregateStatus(
        IReadOnlyCollection<InventorySerialUnitDto> units,
        IReadOnlyCollection<InventoryHolderDto> holders)
    {
        if (holders.Any(h => h.Status == AccessorySerialPhysicalStatus.Missing)
            || units.Any(u => u.PhysicalStatus == AccessorySerialPhysicalStatus.Missing))
        {
            return AccessorySerialPhysicalStatus.Missing;
        }

        if (holders.Any(h => h.Status == AccessorySerialPhysicalStatus.LoanedOut)
            || units.Any(u => u.PhysicalStatus == AccessorySerialPhysicalStatus.LoanedOut))
        {
            return AccessorySerialPhysicalStatus.LoanedOut;
        }

        return AccessorySerialPhysicalStatus.InWarehouse;
    }

    private static InventoryHolderDto ToHolder(InventorySerialUnitDto unit, int? orderId) => new()
    {
        SerialCode = unit.SerialCode,
        Status = unit.PhysicalStatus,
        StatusLabel = AggregateStatusLabel(unit.PhysicalStatus),
        CustomerName = unit.HolderCustomerName,
        Phone = unit.HolderPhone,
        Address = unit.HolderAddress,
        EventDate = unit.MarkedMissingAt,
        OrderId = orderId
    };

    private static InventorySerialUnitDto BuildSerialUnit(
        string code,
        AccessorySerialPhysicalStatus status,
        ManualUnreturnedItem? missing,
        InventoryHolderDto? loan)
    {
        return new InventorySerialUnitDto
        {
            SerialCode = code,
            PhysicalStatus = status,
            StatusLabel = StatusLabel(status),
            HolderCustomerName = missing?.CustomerName ?? loan?.CustomerName,
            HolderPhone = missing?.Phone ?? loan?.Phone,
            HolderAddress = missing?.Address ?? loan?.Address,
            MarkedMissingAt = missing is not null
                ? DateOnly.FromDateTime(missing.CreatedAt.ToUniversalTime())
                : loan?.EventDate
        };
    }

    private static string StatusLabel(AccessorySerialPhysicalStatus status) => status switch
    {
        AccessorySerialPhysicalStatus.LoanedOut => "מושאל",
        AccessorySerialPhysicalStatus.Missing => "חסר / לא הוחזר",
        _ => "במלאי"
    };

    private static string AggregateStatusLabel(AccessorySerialPhysicalStatus status) => status switch
    {
        AccessorySerialPhysicalStatus.LoanedOut => "בהשאלה",
        AccessorySerialPhysicalStatus.Missing => "חסר / לא הוחזר",
        _ => "זמין"
    };

    private async Task<Dictionary<string, InventoryDefinition>> LoadUnlinkedDefinitionsByNamesAsync(
        IReadOnlyCollection<string> names,
        bool tracked,
        CancellationToken cancellationToken)
    {
        var normalized = names
            .Select(n => (n ?? string.Empty).Trim())
            .Where(n => n.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (normalized.Count == 0)
        {
            return new Dictionary<string, InventoryDefinition>(StringComparer.OrdinalIgnoreCase);
        }

        var lowered = normalized.Select(n => n.ToLower()).ToList();
        IQueryable<InventoryDefinition> query = tracked
            ? _db.InventoryDefinitions.Include(d => d.SerialCodes)
            : _db.InventoryDefinitions.AsNoTracking().Include(d => d.SerialCodes);

        var rows = await query
            .Where(d => d.IsActive && d.LinkedEquipmentType == null && lowered.Contains(d.DisplayName.ToLower()))
            .ToListAsync(cancellationToken);

        var result = new Dictionary<string, InventoryDefinition>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in rows)
        {
            result.TryAdd(row.DisplayName, row);
        }

        return result;
    }

    private async Task<Dictionary<string, HashSet<string>>> GetAssignedCatalogCodesForOrderAsync(
        int orderId,
        CancellationToken cancellationToken)
    {
        var pairs = await (
            from le in _db.OrderLoanedEquipments.AsNoTracking()
            join note in _db.LoanedEquipmentNotes.AsNoTracking()
                on le.Id equals note.OrderLoanedEquipmentId
            where le.OrderId == orderId
                  && le.IsCustomItem
                  && le.CustomItemName != null
                  && le.CustomItemName != ""
                  && note.Content != null
                  && note.Content != ""
                  && !note.IsReturned
            select new
            {
                Name = le.CustomItemName!,
                Code = note.Content!
            }).ToListAsync(cancellationToken);

        return GroupCatalogCodesByName(pairs.Select(p => (p.Name, p.Code)));
    }

    private async Task<Dictionary<string, HashSet<string>>> GetActiveCatalogAssignedCodesAsync(
        int? excludeOrderId,
        CancellationToken cancellationToken)
    {
        var query =
            from le in _db.OrderLoanedEquipments.AsNoTracking()
            join order in _db.Orders.AsNoTracking() on le.OrderId equals order.Id
            join note in _db.LoanedEquipmentNotes.AsNoTracking() on le.Id equals note.OrderLoanedEquipmentId
            where !order.IsCancelled
                  && le.IsCustomItem
                  && le.CustomItemName != null
                  && le.CustomItemName != ""
                  && note.Content != null
                  && note.Content != ""
                  && !note.IsReturned
            select new
            {
                Name = le.CustomItemName!,
                Code = note.Content!,
                le.OrderId
            };

        if (excludeOrderId is int excluded)
        {
            query = query.Where(row => row.OrderId != excluded);
        }

        var rows = await query.ToListAsync(cancellationToken);
        return GroupCatalogCodesByName(rows.Select(r => (r.Name, r.Code)));
    }

    private async Task<Dictionary<string, Dictionary<string, InventoryHolderDto>>>
        LoadActiveCatalogLoanHoldersAsync(CancellationToken cancellationToken)
    {
        var rows = await (
            from le in _db.OrderLoanedEquipments.AsNoTracking()
            join order in _db.Orders.AsNoTracking() on le.OrderId equals order.Id
            join note in _db.LoanedEquipmentNotes.AsNoTracking() on le.Id equals note.OrderLoanedEquipmentId
            where !order.IsCancelled
                  && le.IsCustomItem
                  && le.CustomItemName != null
                  && le.CustomItemName != ""
                  && note.Content != null
                  && note.Content != ""
                  && !note.IsReturned
            select new
            {
                Name = le.CustomItemName!,
                Code = note.Content!,
                order.Id,
                order.CustomerName,
                order.Phone,
                order.Address,
                LoanDate = _db.OrderShifts
                    .Where(s => s.OrderId == order.Id)
                    .OrderBy(s => s.OrderDate)
                    .Select(s => (DateOnly?)s.OrderDate)
                    .FirstOrDefault()
            }).ToListAsync(cancellationToken);

        var result = new Dictionary<string, Dictionary<string, InventoryHolderDto>>(StringComparer.OrdinalIgnoreCase);
        foreach (var row in rows)
        {
            var name = row.Name.Trim();
            var code = row.Code.Trim();
            if (name.Length == 0 || code.Length == 0)
            {
                continue;
            }

            if (!result.TryGetValue(name, out var byCode))
            {
                byCode = new Dictionary<string, InventoryHolderDto>(StringComparer.OrdinalIgnoreCase);
                result[name] = byCode;
            }

            byCode.TryAdd(code, new InventoryHolderDto
            {
                SerialCode = code,
                Status = AccessorySerialPhysicalStatus.LoanedOut,
                StatusLabel = AggregateStatusLabel(AccessorySerialPhysicalStatus.LoanedOut),
                CustomerName = row.CustomerName,
                Phone = row.Phone,
                Address = row.Address,
                EventDate = row.LoanDate,
                OrderId = row.Id
            });
        }

        return result;
    }

    private static Dictionary<string, HashSet<string>> ExtractAssignedCatalogCodesByName(
        IReadOnlyCollection<OrderLoanedEquipmentDto> items)
    {
        var result = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in items ?? [])
        {
            if (!item.IsCustomItem || item.Quantity <= 0 || string.IsNullOrWhiteSpace(item.CustomItemName))
            {
                continue;
            }

            var name = item.CustomItemName.Trim();
            if (!result.TryGetValue(name, out var codes))
            {
                codes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                result[name] = codes;
            }

            foreach (var note in item.Notes ?? [])
            {
                if (note.IsReturned)
                {
                    continue;
                }

                var code = (note.Content ?? string.Empty).Trim();
                if (code.Length > 0)
                {
                    codes.Add(code);
                }
            }
        }

        return result;
    }

    private static Dictionary<string, HashSet<string>> GroupCatalogCodesByName(
        IEnumerable<(string Name, string Code)> pairs)
    {
        var result = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var (rawName, rawCode) in pairs)
        {
            var name = (rawName ?? string.Empty).Trim();
            var code = (rawCode ?? string.Empty).Trim();
            if (name.Length == 0 || code.Length == 0)
            {
                continue;
            }

            if (!result.TryGetValue(name, out var codes))
            {
                codes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                result[name] = codes;
            }

            codes.Add(code);
        }

        return result;
    }

    private static bool SetCatalogSerialStatus(
        InventoryDefinition definition,
        string serialCode,
        AccessorySerialPhysicalStatus status)
    {
        var code = (serialCode ?? string.Empty).Trim();
        if (code.Length == 0)
        {
            return false;
        }

        var existing = definition.SerialCodes.FirstOrDefault(s =>
            string.Equals(s.SerialCode, code, StringComparison.OrdinalIgnoreCase));
        if (existing is null)
        {
            return false;
        }

        if (existing.PhysicalStatus == status)
        {
            return false;
        }

        existing.PhysicalStatus = status;
        definition.UpdatedAt = DateTime.UtcNow;
        return true;
    }

    private static bool TryGetCatalogLoan(
        IReadOnlyDictionary<string, Dictionary<string, InventoryHolderDto>> holders,
        string itemName,
        string serialCode,
        out InventoryHolderDto? loan)
    {
        loan = null;
        if (!holders.TryGetValue(itemName, out var byCode))
        {
            return false;
        }

        if (!byCode.TryGetValue(serialCode, out var found))
        {
            return false;
        }

        loan = found;
        return true;
    }
}
