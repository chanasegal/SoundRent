using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Mapping;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Application.Services;

/// <summary>
/// Unified permanent inventory catalog — all serial units live in <see cref="InventorySerialCode"/>.
/// </summary>
public class InventoryDefinitionService : IInventoryDefinitionService
{
    private readonly IInventoryDefinitionRepository _repository;
    private readonly AppDbContext _db;

    public InventoryDefinitionService(
        IInventoryDefinitionRepository repository,
        AppDbContext db)
    {
        _repository = repository;
        _db = db;
    }

    public Task<List<InventoryDefinitionDto>> GetAllAsync(CancellationToken cancellationToken = default) =>
        BuildAllDtosAsync(cancellationToken);

    public async Task<InventoryDefinitionDto> CreateAsync(
        InventoryDefinitionCreateDto dto,
        CancellationToken cancellationToken = default)
    {
        var displayName = ValidateDisplayName(dto.DisplayName, excludeId: null);

        if (await _repository.DisplayNameExistsAsync(displayName, excludeId: null, cancellationToken))
        {
            throw new ValidationException($"פריט בשם \"{displayName}\" כבר קיים במלאי");
        }

        var quantity = dto.Quantity is int q && q > 0 ? Math.Min(q, 200) : 0;
        var codes = ResolveSerialCodes(quantity, dto.SerialCodes);
        quantity = codes.Count;

        var inactive = await _db.InventoryDefinitions
            .Include(d => d.SerialCodes)
            .FirstOrDefaultAsync(
                d => !d.IsActive && d.DisplayName.ToLower() == displayName.ToLower(),
                cancellationToken);

        if (inactive is not null)
        {
            inactive.IsActive = true;
            inactive.Quantity = quantity;
            inactive.UpdatedAt = DateTime.UtcNow;
            ReplaceSerialCollection(inactive, codes);
            await _repository.SaveChangesAsync(cancellationToken);
            return await ToDtoAsync(inactive, cancellationToken);
        }

        var entity = new InventoryDefinition
        {
            DisplayName = displayName,
            SortOrder = await _repository.GetNextSortOrderAsync(cancellationToken),
            Quantity = quantity,
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            SerialCodes = codes.Select(code => new InventorySerialCode
            {
                SerialCode = code,
                PhysicalStatus = AccessorySerialPhysicalStatus.InWarehouse
            }).ToList()
        };

        await _repository.AddAsync(entity, cancellationToken);
        await _repository.SaveChangesAsync(cancellationToken);
        return await ToDtoAsync(entity, cancellationToken);
    }

    public async Task<InventoryDefinitionDto> EnsureByDisplayNameAsync(
        string displayName,
        CancellationToken cancellationToken = default)
    {
        var trimmed = ValidateDisplayName(displayName, excludeId: null);
        var existing = await _repository.FindByDisplayNameAsync(trimmed, cancellationToken);
        if (existing is not null)
        {
            return await ToDtoAsync(existing, cancellationToken);
        }

        return await CreateAsync(new InventoryDefinitionCreateDto
        {
            DisplayName = trimmed,
            Quantity = 0
        }, cancellationToken);
    }

    public async Task<InventoryDefinitionDto> UpdateAsync(
        int id,
        InventoryDefinitionUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await RequireActiveAsync(id, cancellationToken);
        var displayName = ValidateDisplayName(dto.DisplayName, excludeId: id);

        if (await _repository.DisplayNameExistsAsync(displayName, excludeId: id, cancellationToken))
        {
            throw new ValidationException($"פריט בשם \"{displayName}\" כבר קיים במלאי");
        }

        entity.DisplayName = displayName;
        entity.UpdatedAt = DateTime.UtcNow;
        await _repository.SaveChangesAsync(cancellationToken);
        return await ToDtoAsync(entity, cancellationToken);
    }

    public async Task<InventoryDefinitionDto> UpdateRowAsync(
        int id,
        InventoryDefinitionRowUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await RequireActiveAsync(id, cancellationToken);
        var displayName = ValidateDisplayName(dto.DisplayName, excludeId: id);

        if (await _repository.DisplayNameExistsAsync(displayName, excludeId: id, cancellationToken))
        {
            throw new ValidationException($"פריט בשם \"{displayName}\" כבר קיים במלאי");
        }

        var quantity = dto.Quantity is int q ? Math.Max(0, Math.Min(200, q)) : entity.Quantity;
        var codes = ResolveSerialCodes(quantity, dto.SerialCodes);
        quantity = codes.Count;

        entity.DisplayName = displayName;
        entity.Quantity = quantity;
        entity.UpdatedAt = DateTime.UtcNow;
        ReplaceSerialCollection(entity, codes);
        await _repository.SaveChangesAsync(cancellationToken);
        return await ToDtoAsync(entity, cancellationToken);
    }

    public async Task<InventoryDefinitionDto> ReplaceSerialsAsync(
        int id,
        InventoryDefinitionSerialsUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await RequireActiveAsync(id, cancellationToken);
        var codes = NormalizeExplicitCodes(dto.SerialCodes);
        ReplaceSerialCollection(entity, codes);
        entity.Quantity = codes.Count;
        entity.UpdatedAt = DateTime.UtcNow;
        await _repository.SaveChangesAsync(cancellationToken);
        return await ToDtoAsync(entity, cancellationToken);
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

        entity.IsActive = false;
        entity.UpdatedAt = DateTime.UtcNow;

        var defaultAccessories = await _db.EquipmentDefaultAccessories
            .Where(a => a.InventoryDefinitionId == id)
            .ToListAsync(cancellationToken);
        if (defaultAccessories.Count > 0)
        {
            _db.EquipmentDefaultAccessories.RemoveRange(defaultAccessories);
        }

        await _repository.SaveChangesAsync(cancellationToken);
    }

    public async Task<InventoryDefinitionDto> SetSerialStatusAsync(
        int inventoryDefinitionId,
        string serialCode,
        AccessorySerialPhysicalStatus status,
        CancellationToken cancellationToken = default)
    {
        var code = (serialCode ?? string.Empty).Trim();
        if (inventoryDefinitionId <= 0 || code.Length == 0)
        {
            throw new ValidationException("יש להזין קוד פריט");
        }

        if (status is not AccessorySerialPhysicalStatus.InWarehouse
            and not AccessorySerialPhysicalStatus.InRepair)
        {
            throw new ValidationException("סטטוס לא נתמך לעדכון ידני");
        }

        var entity = await RequireActiveAsync(inventoryDefinitionId, cancellationToken);
        var existing = entity.SerialCodes.FirstOrDefault(s =>
            string.Equals(s.SerialCode, code, StringComparison.OrdinalIgnoreCase))
            ?? throw new ValidationException("קוד הפריט לא נמצא במלאי");

        existing.PhysicalStatus = status;
        entity.UpdatedAt = DateTime.UtcNow;
        await _repository.SaveChangesAsync(cancellationToken);

        var all = await BuildAllDtosAsync(cancellationToken);
        return all.First(d => d.Id == inventoryDefinitionId);
    }

    public async Task MarkSerialMissingAsync(
        int inventoryDefinitionId,
        string serialCode,
        CancellationToken cancellationToken = default)
    {
        var entity = await RequireActiveAsync(inventoryDefinitionId, cancellationToken);
        var code = (serialCode ?? string.Empty).Trim();
        if (code.Length == 0)
        {
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
        var entity = await _db.InventoryDefinitions
            .Include(d => d.SerialCodes)
            .FirstOrDefaultAsync(d => d.Id == inventoryDefinitionId && d.IsActive, cancellationToken);
        if (entity is null)
        {
            return;
        }

        var code = (serialCode ?? string.Empty).Trim();
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

    public async Task ValidateOrderInventorySerialsAsync(
        IReadOnlyCollection<OrderLoanedEquipmentDto> items,
        int? excludeOrderId,
        CancellationToken cancellationToken = default)
    {
        var catalogLines = await ResolveCatalogLinesAsync(items, cancellationToken);
        if (catalogLines.Count == 0)
        {
            return;
        }

        var definitionIds = catalogLines.Select(x => x.DefinitionId).Distinct().ToList();
        var definitions = await LoadDefinitionsByIdsAsync(definitionIds, tracked: false, cancellationToken);
        var reservedByDef = excludeOrderId is int orderId
            ? await GetAssignedCodesForOrderAsync(orderId, cancellationToken)
            : new Dictionary<int, HashSet<string>>();
        var activeByDef = await GetActiveAssignedCodesAsync(excludeOrderId, cancellationToken);

        foreach (var (definitionId, item) in catalogLines)
        {
            if (!definitions.TryGetValue(definitionId, out var def))
            {
                throw new ValidationException("פריט המלאי לא נמצא");
            }

            var label = def.DisplayName;
            var allowedCodes = def.SerialCodes
                .Select(s => s.SerialCode.Trim())
                .Where(c => c.Length > 0)
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

            var statusByCode = def.SerialCodes
                .Where(s => s.SerialCode.Trim().Length > 0)
                .ToDictionary(s => s.SerialCode.Trim(), s => s.PhysicalStatus, StringComparer.OrdinalIgnoreCase);

            var selectedCodes = ExtractSelectedCodes(item);

            if (selectedCodes.Count > 0 && selectedCodes.Count != item.Quantity)
            {
                throw new ValidationException($"יש לבחור קוד לכל יחידה עבור \"{label}\"");
            }

            if (selectedCodes.Select(n => n.Code).Distinct(StringComparer.OrdinalIgnoreCase).Count() != selectedCodes.Count)
            {
                throw new ValidationException($"לא ניתן לבחור את אותו קוד פעמיים עבור \"{label}\"");
            }

            reservedByDef.TryGetValue(definitionId, out var reserved);
            reserved ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            activeByDef.TryGetValue(definitionId, out var active);
            active ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var entry in selectedCodes)
            {
                if (!allowedCodes.Contains(entry.Code))
                {
                    throw new ValidationException($"הקוד \"{entry.Code}\" אינו רשום במלאי עבור \"{label}\"");
                }

                if (entry.IsReturned)
                {
                    continue;
                }

                var unavailableByStatus = statusByCode.TryGetValue(entry.Code, out var status)
                    && status is AccessorySerialPhysicalStatus.LoanedOut
                        or AccessorySerialPhysicalStatus.Missing
                        or AccessorySerialPhysicalStatus.InRepair;
                var unavailableByActiveLoan = active.Contains(entry.Code);

                if ((unavailableByStatus || unavailableByActiveLoan) && !reserved.Contains(entry.Code))
                {
                    throw new ValidationException(
                        $"הקוד \"{entry.Code}\" כרגע בחוץ (מושאל) ואינו זמין לבחירה ({label})");
                }
            }
        }
    }

    public async Task SyncInventorySerialStatusForOrderAsync(
        IReadOnlyDictionary<int, HashSet<string>> priorAssignedByDefinitionId,
        IReadOnlyCollection<OrderLoanedEquipmentDto> items,
        CancellationToken cancellationToken = default)
    {
        var nextAssigned = await ExtractAssignedCodesByDefinitionIdAsync(items, cancellationToken);
        var allIds = priorAssignedByDefinitionId.Keys.Concat(nextAssigned.Keys).Distinct().ToList();
        if (allIds.Count == 0)
        {
            return;
        }

        var definitions = await LoadDefinitionsByIdsAsync(allIds, tracked: true, cancellationToken);
        var changed = false;

        foreach (var definitionId in allIds)
        {
            if (!definitions.TryGetValue(definitionId, out var def))
            {
                continue;
            }

            priorAssignedByDefinitionId.TryGetValue(definitionId, out var prior);
            prior ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            nextAssigned.TryGetValue(definitionId, out var next);
            next ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var code in prior.Except(next, StringComparer.OrdinalIgnoreCase))
            {
                if (SetSerialStatus(def, code, AccessorySerialPhysicalStatus.InWarehouse))
                {
                    changed = true;
                }
            }

            foreach (var code in next.Except(prior, StringComparer.OrdinalIgnoreCase))
            {
                if (SetSerialStatus(def, code, AccessorySerialPhysicalStatus.LoanedOut))
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

    public async Task ReleaseReturnedInventorySerialsAsync(
        IReadOnlyCollection<(int InventoryDefinitionId, string SerialCode)> returnedCodes,
        CancellationToken cancellationToken = default)
    {
        if (returnedCodes is null || returnedCodes.Count == 0)
        {
            return;
        }

        var byDef = returnedCodes
            .Select(r => (r.InventoryDefinitionId, Code: (r.SerialCode ?? string.Empty).Trim()))
            .Where(r => r.InventoryDefinitionId > 0 && r.Code.Length > 0)
            .GroupBy(r => r.InventoryDefinitionId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Code).ToHashSet(StringComparer.OrdinalIgnoreCase));

        if (byDef.Count == 0)
        {
            return;
        }

        var definitions = await LoadDefinitionsByIdsAsync(byDef.Keys.ToList(), tracked: true, cancellationToken);
        var changed = false;
        foreach (var (definitionId, codes) in byDef)
        {
            if (!definitions.TryGetValue(definitionId, out var def))
            {
                continue;
            }

            foreach (var code in codes)
            {
                if (SetSerialStatus(def, code, AccessorySerialPhysicalStatus.InWarehouse))
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

    public async Task MarkInventorySerialsLoanedOutAsync(
        IReadOnlyCollection<(int InventoryDefinitionId, string SerialCode)> codesToMark,
        int? excludeOrderId,
        CancellationToken cancellationToken = default)
    {
        if (codesToMark is null || codesToMark.Count == 0)
        {
            return;
        }

        var byDef = codesToMark
            .Select(r => (r.InventoryDefinitionId, Code: (r.SerialCode ?? string.Empty).Trim()))
            .Where(r => r.InventoryDefinitionId > 0 && r.Code.Length > 0)
            .GroupBy(r => r.InventoryDefinitionId)
            .ToDictionary(g => g.Key, g => g.Select(x => x.Code).ToHashSet(StringComparer.OrdinalIgnoreCase));

        var activeByDef = await GetActiveAssignedCodesAsync(excludeOrderId, cancellationToken);
        foreach (var (definitionId, codes) in byDef)
        {
            if (!activeByDef.TryGetValue(definitionId, out var active))
            {
                continue;
            }

            foreach (var code in codes)
            {
                if (active.Contains(code))
                {
                    throw new ValidationException($"לא ניתן לבטל החזרה — קוד {code} כבר מושאל בהשאלה אחרת");
                }
            }
        }

        var definitions = await LoadDefinitionsByIdsAsync(byDef.Keys.ToList(), tracked: true, cancellationToken);
        var changed = false;
        foreach (var (definitionId, codes) in byDef)
        {
            if (!definitions.TryGetValue(definitionId, out var def))
            {
                continue;
            }

            foreach (var code in codes)
            {
                if (SetSerialStatus(def, code, AccessorySerialPhysicalStatus.LoanedOut))
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

    public async Task ReleaseAllOrderInventorySerialsAsync(int orderId, CancellationToken cancellationToken = default)
    {
        var assigned = await GetAssignedCodesForOrderAsync(orderId, cancellationToken);
        var returned = assigned
            .SelectMany(kv => kv.Value.Select(code => (InventoryDefinitionId: kv.Key, SerialCode: code)))
            .ToList();
        await ReleaseReturnedInventorySerialsAsync(returned, cancellationToken);
    }

    public async Task<List<InventorySerialAvailabilityGroupDto>> GetAvailabilityAsync(
        InventorySerialAvailabilityRequestDto request,
        CancellationToken cancellationToken = default)
    {
        var idsFilter = request.InventoryDefinitionIds?.Count > 0
            ? request.InventoryDefinitionIds.Distinct().ToList()
            : null;

        var query = _db.InventoryDefinitions.AsNoTracking()
            .Include(d => d.SerialCodes)
            .Where(d => d.IsActive);
        if (idsFilter is not null)
        {
            query = query.Where(d => idsFilter.Contains(d.Id));
        }

        var definitions = await query.OrderBy(d => d.SortOrder).ThenBy(d => d.Id).ToListAsync(cancellationToken);
        var loanedOutByDef = await GetActiveAssignedCodesAsync(request.ExcludeOrderId, cancellationToken);
        var reservedByDef = request.ExcludeOrderId is int orderId
            ? await GetAssignedCodesForOrderAsync(orderId, cancellationToken)
            : new Dictionary<int, HashSet<string>>();

        return definitions.Select(def =>
        {
            loanedOutByDef.TryGetValue(def.Id, out var loanedOut);
            loanedOut ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            reservedByDef.TryGetValue(def.Id, out var reserved);
            reserved ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            return new InventorySerialAvailabilityGroupDto
            {
                InventoryDefinitionId = def.Id,
                Label = def.DisplayName,
                Options = def.SerialCodes
                    .Select(s => s.SerialCode.Trim())
                    .Where(c => c.Length > 0)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(c => c, NumericStringComparer.Instance)
                    .Select(code => new AccessorySerialOptionDto
                    {
                        SerialCode = code,
                        IsAvailable = !loanedOut.Contains(code) || reserved.Contains(code)
                    })
                    .ToList()
            };
        }).ToList();
    }

    public async Task<InventorySerialLocationDto> GetSerialLocationAsync(
        int inventoryDefinitionId,
        string serialCode,
        CancellationToken cancellationToken = default)
    {
        var code = (serialCode ?? string.Empty).Trim();
        if (inventoryDefinitionId <= 0 || code.Length == 0)
        {
            throw new ValidationException("יש להזין קוד סידורי לחיפוש");
        }

        var def = await _db.InventoryDefinitions.AsNoTracking()
            .Include(d => d.SerialCodes)
            .FirstOrDefaultAsync(d => d.Id == inventoryDefinitionId && d.IsActive, cancellationToken)
            ?? throw new NotFoundException("פריט המלאי לא נמצא");

        var serial = def.SerialCodes.FirstOrDefault(s =>
            string.Equals(s.SerialCode, code, StringComparison.OrdinalIgnoreCase));

        if (serial is null)
        {
            return new InventorySerialLocationDto
            {
                InventoryDefinitionId = def.Id,
                Label = def.DisplayName,
                SerialCode = code,
                IsRegistered = false,
                IsInWarehouse = true
            };
        }

        var holder = await FindActiveHolderAsync(def.Id, code, cancellationToken);
        return new InventorySerialLocationDto
        {
            InventoryDefinitionId = def.Id,
            Label = def.DisplayName,
            SerialCode = serial.SerialCode,
            IsRegistered = true,
            IsInWarehouse = serial.PhysicalStatus == AccessorySerialPhysicalStatus.InWarehouse,
            IsMissing = serial.PhysicalStatus == AccessorySerialPhysicalStatus.Missing,
            OrderId = holder?.OrderId,
            CustomerName = holder?.CustomerName,
            Phone = holder?.Phone,
            Phone2 = holder?.Phone2,
            Address = holder?.Address,
            Deposit = holder?.Deposit,
            Notes = holder?.Notes,
            LoanDate = holder?.LoanDate
        };
    }

    public async Task SetPhysicalStatusAsync(
        int inventoryDefinitionId,
        string serialCode,
        AccessorySerialPhysicalStatus status,
        CancellationToken cancellationToken = default)
    {
        var entity = await RequireActiveAsync(inventoryDefinitionId, cancellationToken);
        var code = (serialCode ?? string.Empty).Trim();
        if (!SetSerialStatus(entity, code, status))
        {
            throw new ValidationException("קוד הפריט לא נמצא במלאי");
        }

        await _repository.SaveChangesAsync(cancellationToken);
    }

    // --- helpers ---

    private async Task<List<InventoryDefinitionDto>> BuildAllDtosAsync(CancellationToken cancellationToken)
    {
        var rows = await _repository.GetAllWithSerialsOrderedAsync(cancellationToken);
        var missingByKey = await LoadUnresolvedMissingByKeyAsync(cancellationToken);
        var missingByDefinition = await LoadUnresolvedMissingByDefinitionAsync(cancellationToken);
        var loanHolders = await LoadActiveLoanHoldersByDefinitionAsync(cancellationToken);
        return rows.Select(r => ToDto(r, missingByKey, missingByDefinition, loanHolders)).ToList();
    }

    private async Task<InventoryDefinitionDto> ToDtoAsync(
        InventoryDefinition entity,
        CancellationToken cancellationToken)
    {
        var missingByKey = await LoadUnresolvedMissingByKeyAsync(cancellationToken);
        var missingByDefinition = await LoadUnresolvedMissingByDefinitionAsync(cancellationToken);
        var loanHolders = await LoadActiveLoanHoldersByDefinitionAsync(cancellationToken);
        return ToDto(entity, missingByKey, missingByDefinition, loanHolders);
    }

    private async Task<InventoryDefinition> RequireActiveAsync(int id, CancellationToken cancellationToken) =>
        await _repository.GetByIdWithSerialsAsync(id, cancellationToken)
        ?? throw new NotFoundException("פריט המלאי לא נמצא");

    private static string ValidateDisplayName(string? raw, int? excludeId)
    {
        var displayName = (raw ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(displayName))
        {
            throw new ValidationException("יש להזין שם פריט");
        }

        if (displayName.Length > 200)
        {
            throw new ValidationException("שם הפריט ארוך מדי");
        }

        return displayName;
    }

    internal static List<string> ResolveSerialCodes(int quantity, IEnumerable<string>? rawCodes)
    {
        if (quantity <= 0)
        {
            return NormalizeExplicitCodes(rawCodes);
        }

        return BuildSerialCodes(quantity, rawCodes);
    }

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

    private static List<string> NormalizeExplicitCodes(IEnumerable<string>? rawCodes)
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
            .Where(s => s.SerialCode.Trim().Length > 0)
            .GroupBy(s => s.SerialCode.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().PhysicalStatus, StringComparer.OrdinalIgnoreCase);

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

    private async Task<List<(int DefinitionId, OrderLoanedEquipmentDto Item)>> ResolveCatalogLinesAsync(
        IReadOnlyCollection<OrderLoanedEquipmentDto> items,
        CancellationToken cancellationToken)
    {
        var result = new List<(int, OrderLoanedEquipmentDto)>();
        var namesToResolve = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in items ?? [])
        {
            if (item.Quantity <= 0 || item.IsCustomItem)
            {
                continue;
            }

            if (item.InventoryDefinitionId is int id and > 0)
            {
                result.Add((id, item));
                continue;
            }

            if (item.LoanedEquipmentType is not null && !string.IsNullOrWhiteSpace(item.CustomItemName))
            {
                namesToResolve.Add(item.CustomItemName.Trim());
            }
            else if (!string.IsNullOrWhiteSpace(item.CustomItemName))
            {
                namesToResolve.Add(item.CustomItemName.Trim());
            }
        }

        if (namesToResolve.Count == 0)
        {
            return result;
        }

        var byName = await _db.InventoryDefinitions.AsNoTracking()
            .Where(d => d.IsActive && namesToResolve.Contains(d.DisplayName))
            .ToDictionaryAsync(d => d.DisplayName, d => d.Id, StringComparer.OrdinalIgnoreCase, cancellationToken);

        foreach (var item in items ?? [])
        {
            if (item.Quantity <= 0 || item.IsCustomItem || item.InventoryDefinitionId is int and > 0)
            {
                continue;
            }

            var name = (item.CustomItemName ?? string.Empty).Trim();
            if (name.Length > 0 && byName.TryGetValue(name, out var id))
            {
                result.Add((id, item));
            }
        }

        return result;
    }

    private static List<(string Code, bool IsReturned)> ExtractSelectedCodes(OrderLoanedEquipmentDto item) =>
        (item.Notes ?? [])
            .OrderBy(n => n.Ordinal)
            .Select(n => ((n.Content ?? string.Empty).Trim(), n.IsReturned))
            .Where(n => n.Item1.Length > 0)
            .ToList();

    private async Task<Dictionary<int, InventoryDefinition>> LoadDefinitionsByIdsAsync(
        IReadOnlyCollection<int> ids,
        bool tracked,
        CancellationToken cancellationToken)
    {
        var idList = ids.Distinct().ToList();
        if (idList.Count == 0)
        {
            return new Dictionary<int, InventoryDefinition>();
        }

        IQueryable<InventoryDefinition> query = tracked
            ? _db.InventoryDefinitions.Include(d => d.SerialCodes)
            : _db.InventoryDefinitions.AsNoTracking().Include(d => d.SerialCodes);

        var rows = await query.Where(d => d.IsActive && idList.Contains(d.Id)).ToListAsync(cancellationToken);
        return rows.ToDictionary(d => d.Id);
    }

    private async Task<Dictionary<int, HashSet<string>>> GetAssignedCodesForOrderAsync(
        int orderId,
        CancellationToken cancellationToken)
    {
        var rows = await (
            from le in _db.OrderLoanedEquipments.AsNoTracking()
            join note in _db.LoanedEquipmentNotes.AsNoTracking() on le.Id equals note.OrderLoanedEquipmentId
            where le.OrderId == orderId
                  && le.InventoryDefinitionId != null
                  && note.Content != null && note.Content != ""
                  && !note.IsReturned
            select new { DefinitionId = le.InventoryDefinitionId!.Value, Code = note.Content! }
        ).ToListAsync(cancellationToken);

        return GroupCodesByDefinitionId(rows.Select(r => (r.DefinitionId, r.Code)));
    }

    private async Task<Dictionary<int, HashSet<string>>> GetActiveAssignedCodesAsync(
        int? excludeOrderId,
        CancellationToken cancellationToken)
    {
        var query =
            from le in _db.OrderLoanedEquipments.AsNoTracking()
            join order in _db.Orders.AsNoTracking() on le.OrderId equals order.Id
            join note in _db.LoanedEquipmentNotes.AsNoTracking() on le.Id equals note.OrderLoanedEquipmentId
            where !order.IsCancelled
                  && le.InventoryDefinitionId != null
                  && note.Content != null && note.Content != ""
                  && !note.IsReturned
            select new { le.OrderId, DefinitionId = le.InventoryDefinitionId!.Value, Code = note.Content! };

        if (excludeOrderId is int excluded)
        {
            query = query.Where(row => row.OrderId != excluded);
        }

        var rows = await query.ToListAsync(cancellationToken);
        return GroupCodesByDefinitionId(rows.Select(r => (r.DefinitionId, r.Code)));
    }

    private async Task<Dictionary<int, Dictionary<string, InventoryHolderDto>>> LoadActiveLoanHoldersByDefinitionAsync(
        CancellationToken cancellationToken)
    {
        var rows = await (
            from le in _db.OrderLoanedEquipments.AsNoTracking()
            join order in _db.Orders.AsNoTracking() on le.OrderId equals order.Id
            join note in _db.LoanedEquipmentNotes.AsNoTracking() on le.Id equals note.OrderLoanedEquipmentId
            where !order.IsCancelled
                  && le.InventoryDefinitionId != null
                  && note.Content != null && note.Content != ""
                  && !note.IsReturned
            select new
            {
                DefinitionId = le.InventoryDefinitionId!.Value,
                Code = note.Content!,
                order.Id,
                order.CustomerName,
                order.Phone,
                order.Address,
                LoanDate = _db.OrderShifts.Where(s => s.OrderId == order.Id).OrderBy(s => s.OrderDate)
                    .Select(s => (DateOnly?)s.OrderDate).FirstOrDefault()
            }).ToListAsync(cancellationToken);

        var result = new Dictionary<int, Dictionary<string, InventoryHolderDto>>();
        foreach (var row in rows)
        {
            var code = row.Code.Trim();
            if (code.Length == 0)
            {
                continue;
            }

            if (!result.TryGetValue(row.DefinitionId, out var byCode))
            {
                byCode = new Dictionary<string, InventoryHolderDto>(StringComparer.OrdinalIgnoreCase);
                result[row.DefinitionId] = byCode;
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

    private async Task<SerialHolderSnapshot?> FindActiveHolderAsync(
        int inventoryDefinitionId,
        string serialCode,
        CancellationToken cancellationToken)
    {
        var row = await (
            from le in _db.OrderLoanedEquipments.AsNoTracking()
            join order in _db.Orders.AsNoTracking() on le.OrderId equals order.Id
            join note in _db.LoanedEquipmentNotes.AsNoTracking() on le.Id equals note.OrderLoanedEquipmentId
            where !order.IsCancelled
                  && le.InventoryDefinitionId == inventoryDefinitionId
                  && note.Content != null
                  && note.Content.ToLower() == serialCode.ToLower()
                  && !note.IsReturned
            select new SerialHolderSnapshot
            {
                OrderId = order.Id,
                CustomerName = order.CustomerName,
                Phone = order.Phone,
                Phone2 = order.Phone2,
                Address = order.Address,
                Deposit = order.DepositOnName,
                Notes = order.Notes,
                LoanDate = _db.OrderShifts.Where(s => s.OrderId == order.Id).OrderBy(s => s.OrderDate)
                    .Select(s => (DateOnly?)s.OrderDate).FirstOrDefault()
            }).FirstOrDefaultAsync(cancellationToken);

        return row;
    }

    private async Task<Dictionary<int, HashSet<string>>> ExtractAssignedCodesByDefinitionIdAsync(
        IReadOnlyCollection<OrderLoanedEquipmentDto> items,
        CancellationToken cancellationToken)
    {
        var resolved = await ResolveCatalogLinesAsync(items, cancellationToken);
        var result = new Dictionary<int, HashSet<string>>();
        foreach (var (definitionId, item) in resolved)
        {
            if (!result.TryGetValue(definitionId, out var codes))
            {
                codes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                result[definitionId] = codes;
            }

            foreach (var (code, isReturned) in ExtractSelectedCodes(item))
            {
                if (!isReturned)
                {
                    codes.Add(code);
                }
            }
        }

        return result;
    }

    private static Dictionary<int, HashSet<string>> GroupCodesByDefinitionId(
        IEnumerable<(int DefinitionId, string Code)> pairs)
    {
        var result = new Dictionary<int, HashSet<string>>();
        foreach (var (definitionId, rawCode) in pairs)
        {
            var code = rawCode.Trim();
            if (code.Length == 0)
            {
                continue;
            }

            if (!result.TryGetValue(definitionId, out var codes))
            {
                codes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                result[definitionId] = codes;
            }

            codes.Add(code);
        }

        return result;
    }

    private static bool SetSerialStatus(
        InventoryDefinition definition,
        string serialCode,
        AccessorySerialPhysicalStatus status)
    {
        var code = serialCode.Trim();
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

    private async Task<Dictionary<string, ManualUnreturnedItem>> LoadUnresolvedMissingByKeyAsync(
        CancellationToken cancellationToken)
    {
        var rows = await _db.ManualUnreturnedItems.AsNoTracking()
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

            if (row.InventoryDefinitionId is int defId and > 0)
            {
                result.TryAdd($"def:{defId}:{code}", row);
            }

            result.TryAdd($"code:{code}", row);
        }

        return result;
    }

    private async Task<Dictionary<int, List<ManualUnreturnedItem>>> LoadUnresolvedMissingByDefinitionAsync(
        CancellationToken cancellationToken)
    {
        var rows = await _db.ManualUnreturnedItems.AsNoTracking()
            .Where(m => !m.IsResolved && m.InventoryDefinitionId != null)
            .OrderByDescending(m => m.CreatedAt)
            .ToListAsync(cancellationToken);

        return rows.GroupBy(m => m.InventoryDefinitionId!.Value).ToDictionary(g => g.Key, g => g.ToList());
    }

    private static InventoryDefinitionDto ToDto(
        InventoryDefinition entity,
        IReadOnlyDictionary<string, ManualUnreturnedItem>? missingByKey,
        IReadOnlyDictionary<int, List<ManualUnreturnedItem>>? missingByDefinition,
        IReadOnlyDictionary<int, Dictionary<string, InventoryHolderDto>>? loanHolders)
    {
        var holders = new List<InventoryHolderDto>();
        Dictionary<string, InventoryHolderDto>? holdersByCode = null;
        loanHolders?.TryGetValue(entity.Id, out holdersByCode);
        holdersByCode ??= new Dictionary<string, InventoryHolderDto>(StringComparer.OrdinalIgnoreCase);

        var units = entity.SerialCodes
            .OrderBy(s => s.SerialCode, NumericStringComparer.Instance)
            .Select(s =>
            {
                var code = s.SerialCode;
                var status = s.PhysicalStatus;
                ManualUnreturnedItem? missing = null;
                InventoryHolderDto? loan = null;

                if (status == AccessorySerialPhysicalStatus.Missing && missingByKey is not null)
                {
                    missingByKey.TryGetValue($"def:{entity.Id}:{code}", out missing);
                    missing ??= missingByKey.GetValueOrDefault($"code:{code}");
                }
                else if (missingByKey is not null
                         && missingByKey.TryGetValue($"def:{entity.Id}:{code}", out var byDef))
                {
                    status = AccessorySerialPhysicalStatus.Missing;
                    missing = byDef;
                }
                else if (status != AccessorySerialPhysicalStatus.Missing
                         && holdersByCode.TryGetValue(code, out loan))
                {
                    status = AccessorySerialPhysicalStatus.LoanedOut;
                }

                var unit = BuildSerialUnit(code, status, missing, loan);
                if (status is AccessorySerialPhysicalStatus.Missing or AccessorySerialPhysicalStatus.LoanedOut)
                {
                    holders.Add(ToHolder(unit, loan?.OrderId));
                }

                return unit;
            }).ToList();

        if (missingByDefinition is not null
            && missingByDefinition.TryGetValue(entity.Id, out var defMissing))
        {
            foreach (var missing in defMissing)
            {
                var code = (missing.ItemCode ?? string.Empty).Trim();
                if (code.Length > 0 && holders.Any(h => string.Equals(h.SerialCode, code, StringComparison.OrdinalIgnoreCase)))
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

        var codes = units.Select(u => u.SerialCode).ToList();
        var aggregate = ResolveAggregateStatus(units, holders);

        return new InventoryDefinitionDto
        {
            Id = entity.Id,
            DisplayName = entity.DisplayName,
            SortOrder = entity.SortOrder,
            TotalQuantity = Math.Max(entity.Quantity, codes.Count),
            SerialCodes = codes,
            SerialUnits = units,
            AggregateStatus = aggregate,
            AggregateStatusLabel = AggregateStatusLabel(aggregate),
            ActiveHolders = holders
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

        if (holders.Any(h => h.Status == AccessorySerialPhysicalStatus.InRepair)
            || units.Any(u => u.PhysicalStatus == AccessorySerialPhysicalStatus.InRepair))
        {
            return AccessorySerialPhysicalStatus.InRepair;
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
        InventoryHolderDto? loan) => new()
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

    private static string StatusLabel(AccessorySerialPhysicalStatus status) => status switch
    {
        AccessorySerialPhysicalStatus.LoanedOut => "מושאל",
        AccessorySerialPhysicalStatus.Missing => "מושאל",
        AccessorySerialPhysicalStatus.InRepair => "בתיקון",
        _ => "במלאי"
    };

    private static string AggregateStatusLabel(AccessorySerialPhysicalStatus status) => status switch
    {
        AccessorySerialPhysicalStatus.LoanedOut => "בהשאלה",
        AccessorySerialPhysicalStatus.Missing => "בהשאלה",
        AccessorySerialPhysicalStatus.InRepair => "בתיקון",
        _ => "זמין"
    };

    private sealed class SerialHolderSnapshot
    {
        public int OrderId { get; init; }
        public string? CustomerName { get; init; }
        public string Phone { get; init; } = string.Empty;
        public string? Phone2 { get; init; }
        public string? Address { get; init; }
        public string? Deposit { get; init; }
        public string? Notes { get; init; }
        public DateOnly? LoanDate { get; init; }
    }
}
