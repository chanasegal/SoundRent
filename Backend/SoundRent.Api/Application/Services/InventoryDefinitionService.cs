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
            while (await _repository.DisplayNameExistsAsync(displayName, excludeId: null, cancellationToken))
            {
                suffix++;
                displayName = $"{label} ({suffix})";
            }

            toAdd.Add(new InventoryDefinition
            {
                DisplayName = displayName,
                SortOrder = (int)type,
                LinkedEquipmentType = type,
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

        return rows.Select(r => ToDto(r, accessoryCodes)).ToList();
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

        var quantity = dto.Quantity is int q && q > 0 ? Math.Min(q, 200) : 0;
        var codes = BuildSerialCodes(quantity, dto.SerialCodes);

        var entity = new InventoryDefinition
        {
            DisplayName = displayName,
            SortOrder = await _repository.GetNextSortOrderAsync(cancellationToken),
            LinkedEquipmentType = null,
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
        var entity = await _repository.GetByIdWithSerialsAsync(id, cancellationToken)
            ?? throw new NotFoundException("פריט המלאי לא נמצא");

        if (entity.LinkedEquipmentType is LoanedEquipmentType linked)
        {
            await _accessorySerials.ReplaceCodesForTypeAsync(linked, Array.Empty<string>(), cancellationToken);
        }

        _repository.Remove(entity);
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
        entity.SerialCodes.Clear();
        foreach (var code in codes)
        {
            entity.SerialCodes.Add(new InventorySerialCode
            {
                SerialCode = code,
                PhysicalStatus = AccessorySerialPhysicalStatus.InWarehouse
            });
        }
    }

    private async Task<InventoryDefinitionDto> ToDtoAsync(
        InventoryDefinition entity,
        CancellationToken cancellationToken)
    {
        Dictionary<LoanedEquipmentType, List<string>>? accessoryCodes = null;
        if (entity.LinkedEquipmentType is LoanedEquipmentType linked)
        {
            accessoryCodes = await _accessorySerials.GetSerialCodesGroupedAsync([linked], cancellationToken);
        }

        return ToDto(entity, accessoryCodes);
    }

    private static InventoryDefinitionDto ToDto(
        InventoryDefinition entity,
        IReadOnlyDictionary<LoanedEquipmentType, List<string>>? accessoryCodes)
    {
        List<string> codes;
        if (entity.LinkedEquipmentType is LoanedEquipmentType linked
            && accessoryCodes is not null
            && accessoryCodes.TryGetValue(linked, out var fromAccessory))
        {
            codes = fromAccessory;
        }
        else
        {
            codes = entity.SerialCodes
                .OrderBy(s => s.Id)
                .Select(s => s.SerialCode)
                .ToList();
        }

        return new InventoryDefinitionDto
        {
            Id = entity.Id,
            DisplayName = entity.DisplayName,
            SortOrder = entity.SortOrder,
            TotalQuantity = codes.Count,
            SerialCodes = codes,
            LinkedEquipmentType = entity.LinkedEquipmentType
        };
    }
}
