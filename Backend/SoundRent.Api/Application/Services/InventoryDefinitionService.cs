using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
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
    private readonly ILogger<InventoryDefinitionService> _logger;

    public InventoryDefinitionService(
        IInventoryDefinitionRepository repository,
        AppDbContext db,
        ILogger<InventoryDefinitionService> logger)
    {
        _repository = repository;
        _db = db;
        _logger = logger;
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
        _logger.LogInformation(
            "[SerialAvailability] ValidateOrderInventorySerials START excludeOrderId={ExcludeOrderId} itemCount={ItemCount} items={Items}",
            excludeOrderId,
            items.Count,
            string.Join("; ", items.Select(i =>
                $"type={i.LoanedEquipmentType}/custom={i.CustomItemName}/defId={i.InventoryDefinitionId}/qty={i.Quantity}/notes=[{string.Join(",", (i.Notes ?? []).Select(n => $"{n.Content}{(n.IsReturned ? ":R" : "")}"))}]")));

        var catalogLines = await ResolveCatalogLinesAsync(items, cancellationToken);
        if (catalogLines.Count == 0)
        {
            _logger.LogInformation(
                "[SerialAvailability] ValidateOrderInventorySerials SKIP — no catalog lines resolved (all custom/unmapped?)");
            return;
        }

        foreach (var (definitionId, item) in catalogLines)
        {
            if (item.InventoryDefinitionId is not int stamped || stamped <= 0)
            {
                item.InventoryDefinitionId = definitionId;
            }
        }

        var definitionIds = catalogLines.Select(x => x.DefinitionId).Distinct().ToList();
        var definitions = await LoadDefinitionsByIdsAsync(definitionIds, tracked: false, cancellationToken);
        var reservedByDef = excludeOrderId is int orderId
            ? await GetAssignedCodesForOrderAsync(orderId, cancellationToken)
            : new Dictionary<int, HashSet<string>>();
        var activeByDef = await GetActiveAssignedCodesAsync(excludeOrderId, cancellationToken);
        var claimedInRequest = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        _logger.LogInformation(
            "[SerialAvailability] ValidateOrderInventorySerials catalogLines={Lines} activeTaken={Active} reservedOnOrder={Reserved}",
            string.Join("; ", catalogLines.Select(x => $"defId={x.DefinitionId}")),
            FormatTakenMap(activeByDef),
            FormatTakenMap(reservedByDef));

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

            if (allowedCodes.Count > 0 && selectedCodes.Count != item.Quantity)
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
                    _logger.LogInformation(
                        "[SerialAvailability] Validate SKIP returned code defId={DefId} label={Label} code={Code}",
                        definitionId, label, entry.Code);
                    continue;
                }

                var claimKey = $"{definitionId}|{entry.Code}";
                if (!claimedInRequest.Add(claimKey))
                {
                    throw new ValidationException(
                        $"הקוד \"{entry.Code}\" נבחר יותר מפעם אחת בהשאלה זו ({label})");
                }

                var unavailableByStatus = statusByCode.TryGetValue(entry.Code, out var status)
                    && status is AccessorySerialPhysicalStatus.LoanedOut
                        or AccessorySerialPhysicalStatus.Missing
                        or AccessorySerialPhysicalStatus.InRepair;
                var unavailableByActiveLoan = active.Contains(entry.Code);
                var isReserved = reserved.Contains(entry.Code);

                _logger.LogInformation(
                    "[SerialAvailability] Validate CHECK defId={DefId} label={Label} code={Code} status={Status} unavailableByStatus={ByStatus} unavailableByActiveLoan={ByLoan} isReservedOnOrder={Reserved} → {Decision}",
                    definitionId,
                    label,
                    entry.Code,
                    statusByCode.TryGetValue(entry.Code, out var st) ? st.ToString() : "(missing)",
                    unavailableByStatus,
                    unavailableByActiveLoan,
                    isReserved,
                    (unavailableByStatus || unavailableByActiveLoan) && !isReserved ? "REJECT taken" : "ALLOW");

                if ((unavailableByStatus || unavailableByActiveLoan) && !reserved.Contains(entry.Code))
                {
                    throw new ValidationException(
                        $"הקוד \"{entry.Code}\" כרגע בחוץ (תפוס) ואינו זמין לבחירה ({label})");
                }
            }
        }

        _logger.LogInformation("[SerialAvailability] ValidateOrderInventorySerials PASS");
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
        // Any loaned unit can be a mixer parent — cascade by InventorySerialCodes.MixerId, not by display name.
        var nextParentSerialIds = ResolveAssignedSerialIds(definitions, nextAssigned);
        var priorParentSerialIds = ResolveAssignedSerialIds(definitions, priorAssignedByDefinitionId);
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
                var serial = FindSerial(def, code);
                if (serial is not null
                    && serial.MixerId is int attachedMixerId
                    && !nextParentSerialIds.Contains(attachedMixerId))
                {
                    // Direct accessory rental (parent mixer not on this order) disconnects attachment.
                    serial.MixerId = null;
                    changed = true;
                }

                if (SetSerialStatus(def, code, AccessorySerialPhysicalStatus.LoanedOut))
                {
                    changed = true;
                }
            }
        }

        // Cascade to all accessories attached to any currently loaned parent on this order
        // (not only newly loaned — also heals accessories missed by earlier syncs).
        if (await CascadeMixerAttachedStatusAsync(
                nextParentSerialIds,
                AccessorySerialPhysicalStatus.LoanedOut,
                keepAssignedOnOrder: nextAssigned,
                cancellationToken))
        {
            changed = true;
        }

        var releasedParents = priorParentSerialIds.Except(nextParentSerialIds).ToHashSet();
        if (await CascadeMixerAttachedStatusAsync(
                releasedParents,
                AccessorySerialPhysicalStatus.InWarehouse,
                keepAssignedOnOrder: nextAssigned,
                cancellationToken))
        {
            changed = true;
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
        var releasedParentIds = ResolveAssignedSerialIds(definitions, byDef);
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

        if (await CascadeMixerAttachedStatusAsync(
                releasedParentIds,
                AccessorySerialPhysicalStatus.InWarehouse,
                keepAssignedOnOrder: null,
                cancellationToken))
        {
            changed = true;
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
        var markedParentIds = ResolveAssignedSerialIds(definitions, byDef);
        var changed = false;
        foreach (var (definitionId, codes) in byDef)
        {
            if (!definitions.TryGetValue(definitionId, out var def))
            {
                continue;
            }

            foreach (var code in codes)
            {
                var serial = FindSerial(def, code);
                if (serial is not null
                    && serial.MixerId is int attachedMixerId
                    && !markedParentIds.Contains(attachedMixerId))
                {
                    serial.MixerId = null;
                    changed = true;
                }

                if (SetSerialStatus(def, code, AccessorySerialPhysicalStatus.LoanedOut))
                {
                    changed = true;
                }
            }
        }

        if (await CascadeMixerAttachedStatusAsync(
                markedParentIds,
                AccessorySerialPhysicalStatus.LoanedOut,
                keepAssignedOnOrder: null,
                cancellationToken))
        {
            changed = true;
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

        _logger.LogInformation(
            "[SerialAvailability] GetAvailability START excludeOrderId={ExcludeOrderId} inventoryDefinitionIds=[{Ids}]",
            request.ExcludeOrderId,
            idsFilter is null ? "(all active)" : string.Join(",", idsFilter));

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

        _logger.LogInformation(
            "[SerialAvailability] GetAvailability takenFromActiveLoans={Taken} reservedOnExcludedOrder={Reserved} definitionCount={DefCount}",
            FormatTakenMap(loanedOutByDef),
            FormatTakenMap(reservedByDef),
            definitions.Count);

        var result = definitions.Select(def =>
        {
            loanedOutByDef.TryGetValue(def.Id, out var loanedOut);
            loanedOut ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            reservedByDef.TryGetValue(def.Id, out var reserved);
            reserved ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            var options = def.SerialCodes
                .Select(s => new { Code = s.SerialCode.Trim(), s.PhysicalStatus })
                .Where(s => s.Code.Length > 0)
                .GroupBy(s => s.Code, StringComparer.OrdinalIgnoreCase)
                .Select(g => g.First())
                .OrderBy(s => s.Code, NumericStringComparer.Instance)
                .Select(s =>
                {
                    var unavailableByStatus = s.PhysicalStatus is AccessorySerialPhysicalStatus.LoanedOut
                        or AccessorySerialPhysicalStatus.Missing
                        or AccessorySerialPhysicalStatus.InRepair;
                    var unavailableByActiveLoan = loanedOut.Contains(s.Code);
                    var isReserved = reserved.Contains(s.Code);
                    var isAvailable = isReserved || (!unavailableByStatus && !unavailableByActiveLoan);

                    if (!isAvailable || unavailableByStatus || unavailableByActiveLoan || isReserved)
                    {
                        _logger.LogInformation(
                            "[SerialAvailability] GetAvailability OPTION defId={DefId} label={Label} code={Code} status={Status} byStatus={ByStatus} byActiveLoan={ByLoan} reserved={Reserved} → isAvailable={Available}",
                            def.Id,
                            def.DisplayName,
                            s.Code,
                            s.PhysicalStatus,
                            unavailableByStatus,
                            unavailableByActiveLoan,
                            isReserved,
                            isAvailable);
                    }

                    return new AccessorySerialOptionDto
                    {
                        SerialCode = s.Code,
                        IsAvailable = isAvailable
                    };
                })
                .ToList();

            var takenCodes = options.Where(o => !o.IsAvailable).Select(o => o.SerialCode).ToList();
            _logger.LogInformation(
                "[SerialAvailability] GetAvailability GROUP defId={DefId} label={Label} totalOptions={Total} taken=[{Taken}]",
                def.Id,
                def.DisplayName,
                options.Count,
                string.Join(",", takenCodes));

            return new InventorySerialAvailabilityGroupDto
            {
                InventoryDefinitionId = def.Id,
                Label = def.DisplayName,
                Options = options
            };
        }).ToList();

        return result;
    }

    public async Task<InventorySerialLocationDto> GetSerialLocationAsync(
        int inventoryDefinitionId,
        string serialCode,
        CancellationToken cancellationToken = default)
    {
        var code = (serialCode ?? string.Empty).Trim();
        _logger.LogInformation(
            "[SerialLocation] START inventoryDefinitionId={InventoryDefinitionId} serialCode={SerialCode}",
            inventoryDefinitionId,
            code);

        if (inventoryDefinitionId <= 0 || code.Length == 0)
        {
            _logger.LogInformation(
                "[SerialLocation] REJECT invalid input inventoryDefinitionId={InventoryDefinitionId} serialCode={SerialCode}",
                inventoryDefinitionId,
                code);
            throw new ValidationException("יש להזין קוד סידורי לחיפוש");
        }

        var def = await _db.InventoryDefinitions.AsNoTracking()
            .Include(d => d.SerialCodes)
            .FirstOrDefaultAsync(d => d.Id == inventoryDefinitionId && d.IsActive, cancellationToken)
            ?? throw new NotFoundException("פריט המלאי לא נמצא");

        _logger.LogInformation(
            "[SerialLocation] Inventory definition FOUND id={DefinitionId} displayName={DisplayName} serialUnitCount={SerialUnitCount}",
            def.Id,
            def.DisplayName,
            def.SerialCodes.Count);

        var serial = def.SerialCodes.FirstOrDefault(s =>
            string.Equals(s.SerialCode, code, StringComparison.OrdinalIgnoreCase));

        if (serial is null)
        {
            _logger.LogInformation(
                "[SerialLocation] Serial code NOT REGISTERED for definition id={DefinitionId} displayName={DisplayName} requestedCode={SerialCode}",
                def.Id,
                def.DisplayName,
                code);

            var unregistered = new InventorySerialLocationDto
            {
                InventoryDefinitionId = def.Id,
                Label = def.DisplayName,
                SerialCode = code,
                IsRegistered = false,
                IsInWarehouse = true
            };
            LogSerialLocationDto("RETURN unregistered", unregistered);
            return unregistered;
        }

        _logger.LogInformation(
            "[SerialLocation] Serial unit FOUND code={SerialCode} physicalStatus={PhysicalStatus} mixerId={MixerId}",
            serial.SerialCode,
            serial.PhysicalStatus,
            serial.MixerId);

        var holder = await ResolveSerialHolderAsync(def, serial, code, cancellationToken);
        var missing = holder is null
            ? await FindMissingHolderAsync(def.Id, code, cancellationToken)
            : null;
        var snapshot = holder ?? missing;

        _logger.LogInformation(
            "[SerialLocation] Holder resolution activeLoan={ActiveLoanFound} missingRecord={MissingFound} holderOrderId={HolderOrderId} missingCustomer={MissingCustomer}",
            holder is not null,
            missing is not null,
            holder?.OrderId,
            missing?.CustomerName ?? "(null)");

        var response = new InventorySerialLocationDto
        {
            InventoryDefinitionId = def.Id,
            Label = def.DisplayName,
            SerialCode = serial.SerialCode,
            IsRegistered = true,
            IsInWarehouse = holder is null
                && missing is null
                && serial.PhysicalStatus == AccessorySerialPhysicalStatus.InWarehouse,
            IsMissing = holder is null
                && (missing is not null || serial.PhysicalStatus == AccessorySerialPhysicalStatus.Missing),
            OrderId = holder?.OrderId > 0 ? holder.OrderId : null,
            CustomerName = snapshot?.CustomerName,
            Phone = snapshot?.Phone,
            Phone2 = snapshot?.Phone2,
            Address = snapshot?.Address,
            Deposit = snapshot?.Deposit ?? holder?.Deposit,
            Notes = snapshot?.Notes ?? holder?.Notes,
            LoanDate = snapshot?.LoanDate
        };

        LogSerialLocationDto("RETURN", response);
        return response;
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
        var mixerSerialCodes = await LoadMixerSerialCodesAsync(rows, cancellationToken);
        return rows.Select(r => ToDto(r, missingByKey, missingByDefinition, loanHolders, mixerSerialCodes)).ToList();
    }

    private async Task<InventoryDefinitionDto> ToDtoAsync(
        InventoryDefinition entity,
        CancellationToken cancellationToken)
    {
        var missingByKey = await LoadUnresolvedMissingByKeyAsync(cancellationToken);
        var missingByDefinition = await LoadUnresolvedMissingByDefinitionAsync(cancellationToken);
        var loanHolders = await LoadActiveLoanHoldersByDefinitionAsync(cancellationToken);
        var mixerSerialCodes = await LoadMixerSerialCodesAsync([entity], cancellationToken);
        return ToDto(entity, missingByKey, missingByDefinition, loanHolders, mixerSerialCodes);
    }

    private async Task<IReadOnlyDictionary<int, string>> LoadMixerSerialCodesAsync(
        IEnumerable<InventoryDefinition> definitions,
        CancellationToken cancellationToken)
    {
        var mixerIds = definitions
            .SelectMany(d => d.SerialCodes)
            .Where(s => s.MixerId != null)
            .Select(s => s.MixerId!.Value)
            .Distinct()
            .ToList();
        if (mixerIds.Count == 0)
        {
            return new Dictionary<int, string>();
        }

        return await _db.InventorySerialCodes.AsNoTracking()
            .Where(s => mixerIds.Contains(s.Id))
            .ToDictionaryAsync(s => s.Id, s => s.SerialCode, cancellationToken);
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
            if (item.Quantity <= 0)
            {
                continue;
            }

            // Prefer explicit catalog id even when a client wrongly flagged IsCustomItem.
            if (item.InventoryDefinitionId is int id and > 0)
            {
                result.Add((id, item));
                continue;
            }

            if (item.LoanedEquipmentType is LoanedEquipmentType type)
            {
                namesToResolve.Add(LoanedEquipmentTypeLabels.GetLabel(type));
            }

            if (!string.IsNullOrWhiteSpace(item.CustomItemName))
            {
                namesToResolve.Add(item.CustomItemName.Trim());
            }
        }

        if (namesToResolve.Count == 0)
        {
            return result;
        }

        var catalogRows = await _db.InventoryDefinitions.AsNoTracking()
            .Where(d => d.IsActive)
            .Select(d => new { d.Id, d.DisplayName })
            .ToListAsync(cancellationToken);

        var byName = catalogRows
            .GroupBy(d => d.DisplayName.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);

        foreach (var item in items ?? [])
        {
            if (item.Quantity <= 0 || item.InventoryDefinitionId is int and > 0)
            {
                continue;
            }

            var candidates = new List<string>();
            if (item.LoanedEquipmentType is LoanedEquipmentType type)
            {
                candidates.Add(LoanedEquipmentTypeLabels.GetLabel(type));
            }

            var customName = (item.CustomItemName ?? string.Empty).Trim();
            if (customName.Length > 0)
            {
                candidates.Add(customName);
            }

            foreach (var name in candidates)
            {
                if (byName.TryGetValue(name, out var id))
                {
                    result.Add((id, item));
                    break;
                }
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
        // Include IsCustomItem rows: legacy quick-loan saved catalog accessories as custom
        // with CustomItemName = display name. ResolveInventoryDefinitionId maps those back.
        var rows = await (
            from le in _db.OrderLoanedEquipments.AsNoTracking()
            join note in _db.LoanedEquipmentNotes.AsNoTracking() on le.Id equals note.OrderLoanedEquipmentId
            where le.OrderId == orderId
                  && note.Content != null && note.Content != ""
                  && !note.IsReturned
            select new
            {
                le.InventoryDefinitionId,
                le.LoanedEquipmentType,
                le.CustomItemName,
                le.IsCustomItem,
                Code = note.Content!
            }
        ).ToListAsync(cancellationToken);

        var lookup = await LoadCatalogDefinitionLookupAsync(cancellationToken);
        var mappedPairs = new List<(int DefinitionId, string Code)>();
        foreach (var r in rows)
        {
            var resolvedId = ResolveInventoryDefinitionId(
                r.InventoryDefinitionId,
                r.LoanedEquipmentType,
                r.CustomItemName,
                lookup);
            if (resolvedId is not int defId || defId <= 0)
            {
                continue;
            }

            mappedPairs.Add((defId, r.Code));
        }

        var result = GroupCodesByDefinitionId(mappedPairs);
        await EnrichActiveAssignedFromAttachedMixersAsync(result, cancellationToken);
        return result;
    }

    private async Task<Dictionary<int, HashSet<string>>> GetActiveAssignedCodesAsync(
        int? excludeOrderId,
        CancellationToken cancellationToken)
    {
        // Do not filter IsCustomItem: quick-loan historically persisted catalog units
        // (e.g. Mixer #90) as custom lines with CustomItemName only.
        var query =
            from le in _db.OrderLoanedEquipments.AsNoTracking()
            join order in _db.Orders.AsNoTracking() on le.OrderId equals order.Id
            join note in _db.LoanedEquipmentNotes.AsNoTracking() on le.Id equals note.OrderLoanedEquipmentId
            where !order.IsCancelled
                  && note.Content != null && note.Content != ""
                  && !note.IsReturned
            select new
            {
                le.OrderId,
                le.InventoryDefinitionId,
                le.LoanedEquipmentType,
                le.CustomItemName,
                le.IsCustomItem,
                Code = note.Content!
            };

        if (excludeOrderId is int excluded)
        {
            query = query.Where(row => row.OrderId != excluded);
        }

        var rows = await query.ToListAsync(cancellationToken);
        var lookup = await LoadCatalogDefinitionLookupAsync(cancellationToken);

        _logger.LogInformation(
            "[SerialAvailability] GetActiveAssignedCodes rawUnreturnedNotes={Count} excludeOrderId={ExcludeOrderId}",
            rows.Count,
            excludeOrderId);

        var mappedPairs = new List<(int DefinitionId, string Code)>();
        foreach (var r in rows)
        {
            var resolvedId = ResolveInventoryDefinitionId(
                r.InventoryDefinitionId,
                r.LoanedEquipmentType,
                r.CustomItemName,
                lookup);
            if (resolvedId is not int defId || defId <= 0)
            {
                _logger.LogWarning(
                    "[SerialAvailability] GetActiveAssignedCodes UNMAPPED → NOT in taken list. OrderId={OrderId} InventoryDefinitionId={RawDefId} Type={Type} CustomName={Custom} IsCustom={IsCustom} Code={Code}",
                    r.OrderId,
                    r.InventoryDefinitionId,
                    r.LoanedEquipmentType?.ToString() ?? "(null)",
                    r.CustomItemName ?? "(null)",
                    r.IsCustomItem,
                    r.Code);
                continue;
            }

            _logger.LogInformation(
                "[SerialAvailability] GetActiveAssignedCodes TAKEN OrderId={OrderId} DefinitionId={DefId} Code={Code} (rawDefId={RawDefId} type={Type} isCustom={IsCustom})",
                r.OrderId,
                defId,
                r.Code.Trim(),
                r.InventoryDefinitionId,
                r.LoanedEquipmentType?.ToString() ?? "(null)",
                r.IsCustomItem);
            mappedPairs.Add((defId, r.Code));
        }

        var result = GroupCodesByDefinitionId(mappedPairs);
        await EnrichActiveAssignedFromAttachedMixersAsync(result, cancellationToken);

        _logger.LogInformation(
            "[SerialAvailability] GetActiveAssignedCodes FINAL taken map (after kit cascade)={Taken}",
            FormatTakenMap(result));
        return result;
    }

    private async Task<(
        Dictionary<int, int> ById,
        Dictionary<LoanedEquipmentType, int> ByType,
        Dictionary<string, int> ByName)> LoadCatalogDefinitionLookupAsync(
        CancellationToken cancellationToken)
    {
        var defs = await _db.InventoryDefinitions.AsNoTracking()
            .Where(d => d.IsActive)
            .Select(d => new { d.Id, d.DisplayName })
            .ToListAsync(cancellationToken);

        var byId = defs.ToDictionary(d => d.Id, d => d.Id);
        var byName = defs
            .GroupBy(d => d.DisplayName.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);
        var byType = new Dictionary<LoanedEquipmentType, int>();
        foreach (LoanedEquipmentType type in Enum.GetValues<LoanedEquipmentType>())
        {
            var label = LoanedEquipmentTypeLabels.GetLabel(type);
            if (byName.TryGetValue(label, out var id))
            {
                byType[type] = id;
            }
        }

        return (byId, byType, byName);
    }

    private async Task EnrichActiveAssignedFromAttachedMixersAsync(
        Dictionary<int, HashSet<string>> activeByDef,
        CancellationToken cancellationToken)
    {
        if (activeByDef.Count == 0)
        {
            _logger.LogInformation(
                "[SerialAvailability] KitCascade SKIP — no active assigned codes to cascade from");
            return;
        }

        var attached = await _db.InventorySerialCodes.AsNoTracking()
            .Where(s => s.MixerId != null)
            .Select(s => new
            {
                s.InventoryDefinitionId,
                s.SerialCode,
                MixerId = s.MixerId!.Value
            })
            .ToListAsync(cancellationToken);

        if (attached.Count > 0)
        {
            var mixerIds = attached.Select(a => a.MixerId).Distinct().ToList();
            var mixers = await _db.InventorySerialCodes.AsNoTracking()
                .Where(s => mixerIds.Contains(s.Id))
                .Select(s => new { s.Id, s.InventoryDefinitionId, s.SerialCode })
                .ToListAsync(cancellationToken);
            var mixerById = mixers.ToDictionary(m => m.Id);

            foreach (var row in attached)
            {
                if (!mixerById.TryGetValue(row.MixerId, out var mixer))
                {
                    continue;
                }

                if (!activeByDef.TryGetValue(mixer.InventoryDefinitionId, out var mixerCodes)
                    || !mixerCodes.Contains(mixer.SerialCode.Trim()))
                {
                    continue;
                }

                _logger.LogInformation(
                    "[SerialAvailability] KitCascade MixerId-link → TAKEN accessoryDefId={DefId} code={Code} because mixer defId={MixerDefId} code={MixerCode} is loaned",
                    row.InventoryDefinitionId,
                    row.SerialCode.Trim(),
                    mixer.InventoryDefinitionId,
                    mixer.SerialCode.Trim());
                AddActiveAssignedCode(activeByDef, row.InventoryDefinitionId, row.SerialCode);
            }
        }

        var mixerLabel = LoanedEquipmentTypeLabels.GetLabel(LoanedEquipmentType.Mixer);
        var mixerDefId = await _db.InventoryDefinitions.AsNoTracking()
            .Where(d => d.IsActive && d.DisplayName == mixerLabel)
            .Select(d => (int?)d.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (mixerDefId is not int mid || !activeByDef.TryGetValue(mid, out var activeMixerCodes))
        {
            return;
        }

        var kitRows = await _db.EquipmentDefaultAccessories.AsNoTracking()
            .Where(k => k.ParentEquipmentType == LoanedEquipmentType.Mixer && k.InventoryDefinitionId != null)
            .Select(k => new
            {
                k.ParentSerialCode,
                DefinitionId = k.InventoryDefinitionId!.Value,
                k.AccessorySerialCode
            })
            .ToListAsync(cancellationToken);

        foreach (var kit in kitRows)
        {
            if (!activeMixerCodes.Contains(kit.ParentSerialCode.Trim()))
            {
                continue;
            }

            _logger.LogInformation(
                "[SerialAvailability] KitCascade DefaultAccessory → TAKEN accessoryDefId={DefId} code={Code} because mixer #{Parent} is loaned",
                kit.DefinitionId,
                kit.AccessorySerialCode.Trim(),
                kit.ParentSerialCode.Trim());
            AddActiveAssignedCode(activeByDef, kit.DefinitionId, kit.AccessorySerialCode);
        }
    }

    private static string FormatTakenMap(IReadOnlyDictionary<int, HashSet<string>> map)
    {
        if (map.Count == 0)
        {
            return "(empty)";
        }

        return string.Join(
            " | ",
            map.OrderBy(kv => kv.Key)
                .Select(kv => $"defId={kv.Key}:[{string.Join(",", kv.Value.OrderBy(c => c))}]"));
    }

    private static void AddActiveAssignedCode(
        Dictionary<int, HashSet<string>> activeByDef,
        int definitionId,
        string serialCode)
    {
        var code = (serialCode ?? string.Empty).Trim();
        if (definitionId <= 0 || code.Length == 0)
        {
            return;
        }

        if (!activeByDef.TryGetValue(definitionId, out var codes))
        {
            codes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            activeByDef[definitionId] = codes;
        }

        codes.Add(code);
    }

    private async Task<Dictionary<int, Dictionary<string, InventoryHolderDto>>> LoadActiveLoanHoldersByDefinitionAsync(
        CancellationToken cancellationToken)
    {
        var lookup = await LoadCatalogDefinitionLookupAsync(cancellationToken);

        var rows = await (
            from le in _db.OrderLoanedEquipments.AsNoTracking()
            join order in _db.Orders.AsNoTracking() on le.OrderId equals order.Id
            join note in _db.LoanedEquipmentNotes.AsNoTracking() on le.Id equals note.OrderLoanedEquipmentId
            where !order.IsCancelled
                  && note.Content != null && note.Content != ""
                  && !note.IsReturned
            select new
            {
                le.InventoryDefinitionId,
                le.LoanedEquipmentType,
                le.CustomItemName,
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

            var definitionId = ResolveInventoryDefinitionId(
                row.InventoryDefinitionId,
                row.LoanedEquipmentType,
                row.CustomItemName,
                lookup);
            if (definitionId is null)
            {
                continue;
            }

            if (!result.TryGetValue(definitionId.Value, out var byCode))
            {
                byCode = new Dictionary<string, InventoryHolderDto>(StringComparer.OrdinalIgnoreCase);
                result[definitionId.Value] = byCode;
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

        await EnrichHoldersFromAttachedMixersAsync(result, cancellationToken);
        return result;
    }

    private async Task EnrichHoldersFromAttachedMixersAsync(
        Dictionary<int, Dictionary<string, InventoryHolderDto>> holdersByDefinition,
        CancellationToken cancellationToken)
    {
        // Accessories attached via MixerId whose parent mixer has an active loan holder.
        var attached = await _db.InventorySerialCodes.AsNoTracking()
            .Where(s => s.MixerId != null)
            .Select(s => new
            {
                s.InventoryDefinitionId,
                s.SerialCode,
                MixerId = s.MixerId!.Value
            })
            .ToListAsync(cancellationToken);

        var pending = new List<(int DefinitionId, string SerialCode, int MixerInventoryDefinitionId, string MixerSerialCode)>();

        if (attached.Count > 0)
        {
            var mixerIds = attached.Select(a => a.MixerId).Distinct().ToList();
            var mixers = await _db.InventorySerialCodes.AsNoTracking()
                .Where(s => mixerIds.Contains(s.Id))
                .Select(s => new { s.Id, s.InventoryDefinitionId, s.SerialCode })
                .ToListAsync(cancellationToken);
            var mixerById = mixers.ToDictionary(m => m.Id);

            foreach (var row in attached)
            {
                if (!mixerById.TryGetValue(row.MixerId, out var mixer))
                {
                    continue;
                }

                pending.Add((row.InventoryDefinitionId, row.SerialCode, mixer.InventoryDefinitionId, mixer.SerialCode));
            }
        }

        // Fallback: kit rows without MixerId still inherit the parent mixer's loan holder.
        var kitRows = await (
            from kit in _db.EquipmentDefaultAccessories.AsNoTracking()
            where kit.ParentEquipmentType == LoanedEquipmentType.Mixer
                  && kit.InventoryDefinitionId != null
            select new
            {
                ParentSerialCode = kit.ParentSerialCode,
                DefinitionId = kit.InventoryDefinitionId!.Value,
                AccessorySerialCode = kit.AccessorySerialCode
            }).ToListAsync(cancellationToken);

        if (kitRows.Count > 0)
        {
            var mixerLabel = LoanedEquipmentTypeLabels.GetLabel(LoanedEquipmentType.Mixer);
            var mixerDefId = await _db.InventoryDefinitions.AsNoTracking()
                .Where(d => d.IsActive && d.DisplayName == mixerLabel)
                .Select(d => (int?)d.Id)
                .FirstOrDefaultAsync(cancellationToken);

            if (mixerDefId is int mid)
            {
                foreach (var kit in kitRows)
                {
                    pending.Add((kit.DefinitionId, kit.AccessorySerialCode, mid, kit.ParentSerialCode));
                }
            }
        }

        foreach (var row in pending)
        {
            var accessoryCode = row.SerialCode.Trim();
            if (accessoryCode.Length == 0)
            {
                continue;
            }

            if (holdersByDefinition.TryGetValue(row.DefinitionId, out var existingByCode)
                && existingByCode.ContainsKey(accessoryCode))
            {
                continue;
            }

            if (!holdersByDefinition.TryGetValue(row.MixerInventoryDefinitionId, out var mixerHolders)
                || !mixerHolders.TryGetValue(row.MixerSerialCode.Trim(), out var mixerHolder))
            {
                continue;
            }

            if (!holdersByDefinition.TryGetValue(row.DefinitionId, out var byCode))
            {
                byCode = new Dictionary<string, InventoryHolderDto>(StringComparer.OrdinalIgnoreCase);
                holdersByDefinition[row.DefinitionId] = byCode;
            }

            byCode.TryAdd(accessoryCode, new InventoryHolderDto
            {
                SerialCode = accessoryCode,
                Status = AccessorySerialPhysicalStatus.LoanedOut,
                StatusLabel = AggregateStatusLabel(AccessorySerialPhysicalStatus.LoanedOut),
                CustomerName = mixerHolder.CustomerName,
                Phone = mixerHolder.Phone,
                Address = mixerHolder.Address,
                EventDate = mixerHolder.EventDate,
                OrderId = mixerHolder.OrderId
            });
        }
    }

    private async Task<SerialHolderSnapshot?> ResolveSerialHolderAsync(
        InventoryDefinition def,
        InventorySerialCode serial,
        string code,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            "[SerialLocation.ResolveHolder] START definitionId={DefinitionId} displayName={DisplayName} serialCode={SerialCode} physicalStatus={PhysicalStatus}",
            def.Id,
            def.DisplayName,
            code,
            serial.PhysicalStatus);

        var holder = await FindActiveHolderAsync(def.Id, def.DisplayName, code, cancellationToken);
        _logger.LogInformation(
            "[SerialLocation.ResolveHolder] After FindActiveHolderAsync found={Found} orderId={OrderId}",
            holder is not null,
            holder?.OrderId);

        if (holder is null)
        {
            holder = await FindHolderViaAttachedMixerAsync(serial, cancellationToken);
            _logger.LogInformation(
                "[SerialLocation.ResolveHolder] After FindHolderViaAttachedMixerAsync found={Found} orderId={OrderId}",
                holder is not null,
                holder?.OrderId);
        }

        if (holder is null)
        {
            holder = await FindActiveHolderFromLoanMapAsync(def.Id, serial.SerialCode, cancellationToken);
            _logger.LogInformation(
                "[SerialLocation.ResolveHolder] After FindActiveHolderFromLoanMapAsync found={Found} orderId={OrderId}",
                holder is not null,
                holder?.OrderId);
        }

        LogHolderSnapshot("[SerialLocation.ResolveHolder] FINAL", holder);
        return holder;
    }

    private async Task<SerialHolderSnapshot?> FindActiveHolderAsync(
        int inventoryDefinitionId,
        string inventoryDisplayName,
        string serialCode,
        CancellationToken cancellationToken)
    {
        var normalizedCode = (serialCode ?? string.Empty).Trim();
        var catalogName = (inventoryDisplayName ?? string.Empty).Trim();
        _logger.LogInformation(
            "[SerialLocation.FindActiveHolder] START inventoryDefinitionId={InventoryDefinitionId} displayName={DisplayName} serialCode={SerialCode}",
            inventoryDefinitionId,
            catalogName,
            normalizedCode);

        if (normalizedCode.Length == 0)
        {
            _logger.LogInformation("[SerialLocation.FindActiveHolder] SKIP empty serial code");
            return null;
        }

        var lookup = await LoadCatalogDefinitionLookupAsync(cancellationToken);

        var candidates = await (
            from le in _db.OrderLoanedEquipments.AsNoTracking()
            join order in _db.Orders.AsNoTracking() on le.OrderId equals order.Id
            join note in _db.LoanedEquipmentNotes.AsNoTracking() on le.Id equals note.OrderLoanedEquipmentId
            where !order.IsCancelled
                  && note.Content != null && note.Content != ""
                  && !note.IsReturned
            select new
            {
                NoteContent = note.Content!,
                le.InventoryDefinitionId,
                le.LoanedEquipmentType,
                le.CustomItemName,
                le.IsCustomItem,
                order.Id
            }).ToListAsync(cancellationToken);

        _logger.LogInformation(
            "[SerialLocation.FindActiveHolder] Loaded {CandidateCount} active unreturned order notes (all definitions)",
            candidates.Count);

        var serialMatches = candidates
            .Where(candidate =>
                string.Equals(candidate.NoteContent.Trim(), normalizedCode, StringComparison.OrdinalIgnoreCase))
            .ToList();

        _logger.LogInformation(
            "[SerialLocation.FindActiveHolder] Serial code matches={SerialMatchCount} rows={Rows}",
            serialMatches.Count,
            serialMatches.Count == 0
                ? "(none)"
                : string.Join(
                    " | ",
                    serialMatches.Select(match =>
                        $"orderId={match.Id} lineDefId={match.InventoryDefinitionId?.ToString() ?? "null"} type={match.LoanedEquipmentType?.ToString() ?? "null"} customName={match.CustomItemName ?? "null"} isCustom={match.IsCustomItem} note={match.NoteContent.Trim()}")));

        var row = candidates.FirstOrDefault(candidate =>
            string.Equals(candidate.NoteContent.Trim(), normalizedCode, StringComparison.OrdinalIgnoreCase)
            && LineMatchesInventoryDefinition(
                candidate.InventoryDefinitionId,
                candidate.LoanedEquipmentType,
                candidate.CustomItemName,
                candidate.IsCustomItem,
                inventoryDefinitionId,
                catalogName,
                lookup));

        if (row is null)
        {
            _logger.LogInformation(
                "[SerialLocation.FindActiveHolder] NO MATCH for definition id={InventoryDefinitionId} displayName={DisplayName} serialCode={SerialCode} (serialMatches={SerialMatchCount} but none mapped to this definition)",
                inventoryDefinitionId,
                catalogName,
                normalizedCode,
                serialMatches.Count);
            return null;
        }

        _logger.LogInformation(
            "[SerialLocation.FindActiveHolder] MATCH orderId={OrderId} lineDefId={LineDefId} type={Type} customName={CustomName} isCustom={IsCustom}",
            row.Id,
            row.InventoryDefinitionId,
            row.LoanedEquipmentType,
            row.CustomItemName,
            row.IsCustomItem);

        var snapshot = await LoadOrderHolderSnapshotAsync(row.Id, cancellationToken);
        LogHolderSnapshot("[SerialLocation.FindActiveHolder] RETURN", snapshot);
        return snapshot;
    }

    private async Task<SerialHolderSnapshot?> FindActiveHolderFromLoanMapAsync(
        int inventoryDefinitionId,
        string serialCode,
        CancellationToken cancellationToken)
    {
        var normalizedCode = (serialCode ?? string.Empty).Trim();
        _logger.LogInformation(
            "[SerialLocation.FindActiveHolderFromLoanMap] START inventoryDefinitionId={InventoryDefinitionId} serialCode={SerialCode}",
            inventoryDefinitionId,
            normalizedCode);

        if (normalizedCode.Length == 0)
        {
            _logger.LogInformation("[SerialLocation.FindActiveHolderFromLoanMap] SKIP empty serial code");
            return null;
        }

        var holders = await LoadActiveLoanHoldersByDefinitionAsync(cancellationToken);
        if (!holders.TryGetValue(inventoryDefinitionId, out var byCode))
        {
            _logger.LogInformation(
                "[SerialLocation.FindActiveHolderFromLoanMap] NO holders for definition id={InventoryDefinitionId}",
                inventoryDefinitionId);
            return null;
        }

        _logger.LogInformation(
            "[SerialLocation.FindActiveHolderFromLoanMap] Definition has {HolderCount} active holder entries codes=[{Codes}]",
            byCode.Count,
            string.Join(",", byCode.Keys.OrderBy(c => c)));

        if (!byCode.TryGetValue(normalizedCode, out var loan))
        {
            loan = byCode.Values.FirstOrDefault(h =>
                string.Equals(h.SerialCode, normalizedCode, StringComparison.OrdinalIgnoreCase));
        }

        if (loan is null)
        {
            _logger.LogInformation(
                "[SerialLocation.FindActiveHolderFromLoanMap] Serial code NOT in loan map definitionId={InventoryDefinitionId} serialCode={SerialCode}",
                inventoryDefinitionId,
                normalizedCode);
            return null;
        }

        _logger.LogInformation(
            "[SerialLocation.FindActiveHolderFromLoanMap] Loan map entry serialCode={SerialCode} orderId={OrderId} customerName={CustomerName} phone={Phone}",
            loan.SerialCode,
            loan.OrderId,
            loan.CustomerName ?? "(null)",
            loan.Phone ?? "(null)");

        if (loan.OrderId is not int orderId || orderId <= 0)
        {
            _logger.LogInformation(
                "[SerialLocation.FindActiveHolderFromLoanMap] Loan map entry has no valid orderId (orderId={OrderId})",
                loan.OrderId);
            return null;
        }

        var snapshot = await LoadOrderHolderSnapshotAsync(orderId, cancellationToken);
        LogHolderSnapshot("[SerialLocation.FindActiveHolderFromLoanMap] RETURN", snapshot);
        return snapshot;
    }

    private async Task<SerialHolderSnapshot?> LoadOrderHolderSnapshotAsync(
        int orderId,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            "[SerialLocation.LoadOrderHolderSnapshot] START orderId={OrderId}",
            orderId);

        var row = await _db.Orders.AsNoTracking()
            .Where(o => o.Id == orderId && !o.IsCancelled)
            .Select(o => new
            {
                o.Id,
                o.CustomerName,
                o.Phone,
                o.Phone2,
                o.Address,
                o.DepositOnName,
                o.Notes,
                LoanDate = _db.OrderShifts.Where(s => s.OrderId == o.Id).OrderBy(s => s.OrderDate)
                    .Select(s => (DateOnly?)s.OrderDate).FirstOrDefault()
            })
            .FirstOrDefaultAsync(cancellationToken);

        if (row is null)
        {
            _logger.LogInformation(
                "[SerialLocation.LoadOrderHolderSnapshot] Order NOT FOUND or cancelled orderId={OrderId}",
                orderId);
            return null;
        }

        var snapshot = new SerialHolderSnapshot
        {
            OrderId = row.Id,
            CustomerName = row.CustomerName,
            Phone = row.Phone,
            Phone2 = row.Phone2,
            Address = row.Address,
            Deposit = row.DepositOnName,
            Notes = row.Notes,
            LoanDate = row.LoanDate
        };

        LogHolderSnapshot("[SerialLocation.LoadOrderHolderSnapshot] RETURN", snapshot);
        return snapshot;
    }

    private async Task<SerialHolderSnapshot?> FindMissingHolderAsync(
        int inventoryDefinitionId,
        string serialCode,
        CancellationToken cancellationToken)
    {
        var normalizedCode = (serialCode ?? string.Empty).Trim();
        if (normalizedCode.Length == 0)
        {
            return null;
        }

        var rows = await _db.ManualUnreturnedItems.AsNoTracking()
            .Where(m =>
                !m.IsResolved
                && m.InventoryDefinitionId == inventoryDefinitionId
                && m.ItemCode != null
                && m.ItemCode != "")
            .OrderByDescending(m => m.CreatedAt)
            .ToListAsync(cancellationToken);

        var match = rows.FirstOrDefault(row =>
            string.Equals((row.ItemCode ?? string.Empty).Trim(), normalizedCode, StringComparison.OrdinalIgnoreCase));
        if (match is null)
        {
            return null;
        }

        return new SerialHolderSnapshot
        {
            CustomerName = match.CustomerName,
            Phone = match.Phone,
            Address = match.Address,
            LoanDate = DateOnly.FromDateTime(match.CreatedAt.ToUniversalTime())
        };
    }

    private static bool LineMatchesInventoryDefinition(
        int? lineInventoryDefinitionId,
        LoanedEquipmentType? loanedEquipmentType,
        string? customItemName,
        bool isCustomItem,
        int targetInventoryDefinitionId,
        string targetDisplayName,
        (
            Dictionary<int, int> ById,
            Dictionary<LoanedEquipmentType, int> ByType,
            Dictionary<string, int> ByName) lookup)
    {
        if (lineInventoryDefinitionId == targetInventoryDefinitionId)
        {
            return true;
        }

        var resolvedId = ResolveInventoryDefinitionId(
            lineInventoryDefinitionId,
            loanedEquipmentType,
            customItemName,
            lookup);
        if (resolvedId == targetInventoryDefinitionId)
        {
            return true;
        }

        var customName = (customItemName ?? string.Empty).Trim();
        if (customName.Length > 0
            && customName.Equals(targetDisplayName, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        // Legacy rows: catalog accessories persisted as custom lines (quick-loan / enum-less catalog).
        return isCustomItem
               && customName.Length > 0
               && lookup.ByName.TryGetValue(customName, out var byNameId)
               && byNameId == targetInventoryDefinitionId;
    }

    private static int? ResolveInventoryDefinitionId(
        int? inventoryDefinitionId,
        LoanedEquipmentType? loanedEquipmentType,
        string? customItemName,
        (
            Dictionary<int, int> ById,
            Dictionary<LoanedEquipmentType, int> ByType,
            Dictionary<string, int> ByName) lookup)
    {
        if (inventoryDefinitionId is int id and > 0 && lookup.ById.ContainsKey(id))
        {
            return id;
        }

        if (loanedEquipmentType is LoanedEquipmentType type && lookup.ByType.TryGetValue(type, out var byTypeId))
        {
            return byTypeId;
        }

        var name = (customItemName ?? string.Empty).Trim();
        if (name.Length > 0 && lookup.ByName.TryGetValue(name, out var byNameId))
        {
            return byNameId;
        }

        return inventoryDefinitionId is int fallback and > 0 ? fallback : null;
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

    private async Task<SerialHolderSnapshot?> FindHolderViaAttachedMixerAsync(
        InventorySerialCode serial,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            "[SerialLocation.FindHolderViaAttachedMixer] START accessoryDefId={AccessoryDefId} serialCode={SerialCode} mixerId={MixerId}",
            serial.InventoryDefinitionId,
            serial.SerialCode,
            serial.MixerId);

        if (serial.MixerId is int mixerId)
        {
            var mixer = await _db.InventorySerialCodes.AsNoTracking()
                .Include(s => s.InventoryDefinition)
                .FirstOrDefaultAsync(s => s.Id == mixerId, cancellationToken);

            _logger.LogInformation(
                "[SerialLocation.FindHolderViaAttachedMixer] MixerId lookup found={Found} mixerDefId={MixerDefId} mixerCode={MixerCode}",
                mixer is not null,
                mixer?.InventoryDefinitionId,
                mixer?.SerialCode);

            if (mixer?.InventoryDefinition is not null)
            {
                var viaFk = await FindActiveHolderAsync(
                    mixer.InventoryDefinitionId,
                    mixer.InventoryDefinition.DisplayName,
                    mixer.SerialCode,
                    cancellationToken);
                if (viaFk is not null)
                {
                    _logger.LogInformation(
                        "[SerialLocation.FindHolderViaAttachedMixer] Resolved via MixerId FK orderId={OrderId}",
                        viaFk.OrderId);
                    return viaFk;
                }
            }
        }

        // Fallback via default-accessory kit when MixerId is not set yet.
        var accessoryCode = serial.SerialCode.Trim();
        var kitRows = await _db.EquipmentDefaultAccessories.AsNoTracking()
            .Where(e => e.ParentEquipmentType == LoanedEquipmentType.Mixer
                        && e.InventoryDefinitionId == serial.InventoryDefinitionId)
            .Select(e => new { e.ParentSerialCode, e.AccessorySerialCode })
            .ToListAsync(cancellationToken);

        _logger.LogInformation(
            "[SerialLocation.FindHolderViaAttachedMixer] Kit rows for accessory defId={DefId} count={Count}",
            serial.InventoryDefinitionId,
            kitRows.Count);

        var kit = kitRows.FirstOrDefault(k =>
            string.Equals((k.AccessorySerialCode ?? string.Empty).Trim(), accessoryCode, StringComparison.OrdinalIgnoreCase));

        if (kit is null)
        {
            _logger.LogInformation(
                "[SerialLocation.FindHolderViaAttachedMixer] NO kit match for accessoryCode={AccessoryCode}",
                accessoryCode);
            return null;
        }

        _logger.LogInformation(
            "[SerialLocation.FindHolderViaAttachedMixer] Kit match parentSerialCode={ParentSerialCode}",
            kit.ParentSerialCode);

        var mixerLabel = LoanedEquipmentTypeLabels.GetLabel(LoanedEquipmentType.Mixer);
        var mixerDefinition = await _db.InventoryDefinitions.AsNoTracking()
            .FirstOrDefaultAsync(
                d => d.IsActive && d.DisplayName == mixerLabel,
                cancellationToken);

        if (mixerDefinition is null)
        {
            _logger.LogInformation(
                "[SerialLocation.FindHolderViaAttachedMixer] Mixer catalog definition NOT FOUND label={MixerLabel}",
                mixerLabel);
            return null;
        }

        var viaKit = await FindActiveHolderAsync(
            mixerDefinition.Id,
            mixerDefinition.DisplayName,
            kit.ParentSerialCode,
            cancellationToken);
        _logger.LogInformation(
            "[SerialLocation.FindHolderViaAttachedMixer] Resolved via kit found={Found} orderId={OrderId}",
            viaKit is not null,
            viaKit?.OrderId);
        return viaKit;
    }

    private async Task<bool> CascadeMixerAttachedStatusAsync(
        IReadOnlyCollection<int> parentSerialIds,
        AccessorySerialPhysicalStatus status,
        IReadOnlyDictionary<int, HashSet<string>>? keepAssignedOnOrder,
        CancellationToken cancellationToken)
    {
        if (parentSerialIds.Count == 0)
        {
            return false;
        }

        var parentIdList = parentSerialIds.Distinct().ToList();
        var parents = await _db.InventorySerialCodes
            .Where(s => parentIdList.Contains(s.Id))
            .Select(s => new { s.Id, SerialCode = s.SerialCode.Trim() })
            .ToListAsync(cancellationToken);

        if (parents.Count == 0)
        {
            return false;
        }

        var attachedById = new Dictionary<int, InventorySerialCode>();

        foreach (var serial in await _db.InventorySerialCodes
                     .Where(s => s.MixerId != null && parentIdList.Contains(s.MixerId.Value))
                     .ToListAsync(cancellationToken))
        {
            attachedById[serial.Id] = serial;
        }

        // Fallback: kit mappings may exist without MixerId (pre-migration / unsynced rows).
        var parentCodes = parents
            .Where(p => p.SerialCode.Length > 0)
            .Select(p => p.SerialCode)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (parentCodes.Count > 0)
        {
            var kitRows = await _db.EquipmentDefaultAccessories.AsNoTracking()
                .Where(e => e.ParentEquipmentType == LoanedEquipmentType.Mixer
                            && e.InventoryDefinitionId != null
                            && parentCodes.Contains(e.ParentSerialCode))
                .Select(e => new
                {
                    ParentSerialCode = e.ParentSerialCode.Trim(),
                    DefinitionId = e.InventoryDefinitionId!.Value,
                    AccessorySerialCode = e.AccessorySerialCode.Trim()
                })
                .ToListAsync(cancellationToken);

            if (kitRows.Count > 0)
            {
                var parentIdByCode = parents
                    .Where(p => p.SerialCode.Length > 0)
                    .GroupBy(p => p.SerialCode, StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.First().Id, StringComparer.OrdinalIgnoreCase);

                var kitDefIds = kitRows.Select(k => k.DefinitionId).Distinct().ToList();
                var kitCodes = kitRows
                    .Where(k => k.AccessorySerialCode.Length > 0)
                    .Select(k => k.AccessorySerialCode)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();

                var kitSerials = await _db.InventorySerialCodes
                    .Where(s => kitDefIds.Contains(s.InventoryDefinitionId)
                                && kitCodes.Contains(s.SerialCode))
                    .ToListAsync(cancellationToken);

                var kitLookup = kitSerials
                    .GroupBy(
                        s => $"{s.InventoryDefinitionId}:{s.SerialCode.Trim()}",
                        StringComparer.OrdinalIgnoreCase)
                    .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

                foreach (var kit in kitRows)
                {
                    if (kit.AccessorySerialCode.Length == 0
                        || !parentIdByCode.TryGetValue(kit.ParentSerialCode, out var parentId))
                    {
                        continue;
                    }

                    var key = $"{kit.DefinitionId}:{kit.AccessorySerialCode}";
                    if (!kitLookup.TryGetValue(key, out var accessory))
                    {
                        continue;
                    }

                    // Heal MixerId when unset; never steal an accessory already attached to another mixer.
                    if (accessory.MixerId is int existing && existing != parentId)
                    {
                        continue;
                    }

                    if (accessory.MixerId is null)
                    {
                        accessory.MixerId = parentId;
                    }

                    attachedById[accessory.Id] = accessory;
                }
            }
        }

        if (attachedById.Count == 0)
        {
            return false;
        }

        IReadOnlyDictionary<int, HashSet<string>>? stillAssigned = keepAssignedOnOrder;
        if (status == AccessorySerialPhysicalStatus.InWarehouse && stillAssigned is null)
        {
            stillAssigned = await GetActiveAssignedCodesAsync(excludeOrderId: null, cancellationToken);
        }

        var changed = false;
        foreach (var serial in attachedById.Values)
        {
            if (status == AccessorySerialPhysicalStatus.InWarehouse
                && stillAssigned is not null
                && stillAssigned.TryGetValue(serial.InventoryDefinitionId, out var keepCodes)
                && keepCodes.Contains(serial.SerialCode))
            {
                continue;
            }

            var entry = _db.Entry(serial);
            if (entry.Property(s => s.MixerId).IsModified)
            {
                changed = true;
            }

            if (serial.PhysicalStatus == status)
            {
                continue;
            }

            serial.PhysicalStatus = status;
            changed = true;
        }

        return changed;
    }

    /// <summary>
    /// Resolves <see cref="InventorySerialCode.Id"/> values for all assigned codes on the order.
    /// Cascade uses these ids to find accessories where <c>MixerId</c> points at a loaned parent.
    /// </summary>
    private static HashSet<int> ResolveAssignedSerialIds(
        IReadOnlyDictionary<int, InventoryDefinition> definitions,
        IReadOnlyDictionary<int, HashSet<string>> assignedByDefinitionId)
    {
        var result = new HashSet<int>();

        foreach (var (definitionId, codes) in assignedByDefinitionId)
        {
            if (!definitions.TryGetValue(definitionId, out var def))
            {
                continue;
            }

            foreach (var code in codes)
            {
                var serial = FindSerial(def, code);
                if (serial is not null)
                {
                    result.Add(serial.Id);
                }
            }
        }

        return result;
    }

    private static InventorySerialCode? FindSerial(InventoryDefinition definition, string serialCode)
    {
        var code = serialCode.Trim();
        if (code.Length == 0)
        {
            return null;
        }

        return definition.SerialCodes.FirstOrDefault(s =>
            string.Equals(s.SerialCode, code, StringComparison.OrdinalIgnoreCase));
    }

    private static bool SetSerialStatus(
        InventoryDefinition definition,
        string serialCode,
        AccessorySerialPhysicalStatus status)
    {
        var existing = FindSerial(definition, serialCode);
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
        IReadOnlyDictionary<int, Dictionary<string, InventoryHolderDto>>? loanHolders,
        IReadOnlyDictionary<int, string>? mixerSerialCodes = null)
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

                var mixerId = s.MixerId;
                string? mixerSerialCode = null;
                if (mixerId is int mid
                    && mixerSerialCodes is not null
                    && mixerSerialCodes.TryGetValue(mid, out var mixerCode))
                {
                    mixerSerialCode = mixerCode;
                }

                var unit = BuildSerialUnit(code, status, missing, loan, mixerId, mixerSerialCode);
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
        InventoryHolderDto? loan,
        int? mixerId = null,
        string? mixerSerialCode = null) => new()
    {
        SerialCode = code,
        PhysicalStatus = status,
        StatusLabel = StatusLabel(status),
        HolderCustomerName = missing?.CustomerName ?? loan?.CustomerName,
        HolderPhone = missing?.Phone ?? loan?.Phone,
        HolderAddress = missing?.Address ?? loan?.Address,
        MarkedMissingAt = missing is not null
            ? DateOnly.FromDateTime(missing.CreatedAt.ToUniversalTime())
            : loan?.EventDate,
        MixerId = mixerId,
        MixerSerialCode = mixerSerialCode
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

    private void LogHolderSnapshot(string stage, SerialHolderSnapshot? snapshot)
    {
        if (snapshot is null)
        {
            _logger.LogInformation("{Stage} holder=(null)", stage);
            return;
        }

        _logger.LogInformation(
            "{Stage} orderId={OrderId} customerName={CustomerName} phone={Phone} phone2={Phone2} address={Address} deposit={Deposit} notes={Notes} loanDate={LoanDate}",
            stage,
            snapshot.OrderId,
            snapshot.CustomerName ?? "(null)",
            snapshot.Phone ?? "(null)",
            snapshot.Phone2 ?? "(null)",
            snapshot.Address ?? "(null)",
            snapshot.Deposit ?? "(null)",
            snapshot.Notes ?? "(null)",
            snapshot.LoanDate?.ToString("yyyy-MM-dd") ?? "(null)");
    }

    private void LogSerialLocationDto(string stage, InventorySerialLocationDto dto)
    {
        _logger.LogInformation(
            "{Stage} inventoryDefinitionId={InventoryDefinitionId} label={Label} serialCode={SerialCode} isRegistered={IsRegistered} isInWarehouse={IsInWarehouse} isMissing={IsMissing} orderId={OrderId} customerName={CustomerName} phone={Phone} phone2={Phone2} address={Address} deposit={Deposit} notes={Notes} loanDate={LoanDate}",
            stage,
            dto.InventoryDefinitionId,
            dto.Label,
            dto.SerialCode,
            dto.IsRegistered,
            dto.IsInWarehouse,
            dto.IsMissing,
            dto.OrderId?.ToString() ?? "(null)",
            dto.CustomerName ?? "(null)",
            dto.Phone ?? "(null)",
            dto.Phone2 ?? "(null)",
            dto.Address ?? "(null)",
            dto.Deposit ?? "(null)",
            dto.Notes ?? "(null)",
            dto.LoanDate?.ToString("yyyy-MM-dd") ?? "(null)");
    }

    private sealed class SerialHolderSnapshot
    {
        public int OrderId { get; init; }
        public string? CustomerName { get; init; }
        public string? Phone { get; init; }
        public string? Phone2 { get; init; }
        public string? Address { get; init; }
        public string? Deposit { get; init; }
        public string? Notes { get; init; }
        public DateOnly? LoanDate { get; init; }
    }
}
