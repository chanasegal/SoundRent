using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Mapping;
using SoundRent.Api.Application.Validation;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Application.Services;

public class EquipmentDefaultAccessoryService : IEquipmentDefaultAccessoryService
{
    private readonly AppDbContext _db;

    public EquipmentDefaultAccessoryService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<List<EquipmentDefaultAccessoryDto>> GetByParentUnitAsync(
        LoanedEquipmentType parentEquipmentType,
        string parentSerialCode,
        CancellationToken cancellationToken = default)
    {
        var parentCode = NormalizeCode(parentSerialCode);
        if (string.IsNullOrWhiteSpace(parentCode))
        {
            return [];
        }

        var parentCodeLower = parentCode.ToLowerInvariant();
        var rows = await _db.EquipmentDefaultAccessories
            .AsNoTracking()
            .Include(e => e.InventoryDefinition)
            .Where(e => e.ParentEquipmentType == parentEquipmentType
                        && e.ParentSerialCode.ToLower() == parentCodeLower)
            .OrderBy(e => e.InventoryDefinition != null ? e.InventoryDefinition.DisplayName : "")
            .ThenBy(e => e.AccessoryEquipmentType)
            .ThenBy(e => e.AccessorySerialCode)
            .ToListAsync(cancellationToken);

        return rows.Select(e => Map(e)).ToList();
    }

    public async Task<List<EquipmentDefaultAccessoryCountDto>> GetCountsByParentUnitAsync(
        LoanedEquipmentType? parentEquipmentType = null,
        CancellationToken cancellationToken = default)
    {
        var query = _db.EquipmentDefaultAccessories.AsNoTracking();
        if (parentEquipmentType.HasValue)
        {
            query = query.Where(e => e.ParentEquipmentType == parentEquipmentType.Value);
        }

        return await query
            .GroupBy(e => new { e.ParentEquipmentType, e.ParentSerialCode })
            .Select(g => new EquipmentDefaultAccessoryCountDto
            {
                ParentEquipmentType = g.Key.ParentEquipmentType,
                ParentSerialCode = g.Key.ParentSerialCode,
                Count = g.Count()
            })
            .OrderBy(c => c.ParentEquipmentType)
            .ThenBy(c => c.ParentSerialCode)
            .ToListAsync(cancellationToken);
    }

    public async Task<EquipmentDefaultAccessoryDto> CreateAsync(
        CreateEquipmentDefaultAccessoryDto dto,
        CancellationToken cancellationToken = default)
    {
        var created = await CreateBatchAsync(
            new CreateEquipmentDefaultAccessoriesBatchDto
            {
                ParentEquipmentType = dto.ParentEquipmentType,
                ParentSerialCode = dto.ParentSerialCode,
                InventoryDefinitionId = dto.InventoryDefinitionId,
                AccessoryEquipmentType = dto.AccessoryEquipmentType,
                AccessorySerialCodes = [dto.AccessorySerialCode]
            },
            cancellationToken);

        return created[0];
    }

    public async Task<List<EquipmentDefaultAccessoryDto>> CreateBatchAsync(
        CreateEquipmentDefaultAccessoriesBatchDto dto,
        CancellationToken cancellationToken = default)
    {
        if (!Enum.IsDefined(dto.ParentEquipmentType))
        {
            throw new ValidationException("סוג ציוד ראשי אינו תקין");
        }

        var parentCode = NormalizeCode(dto.ParentSerialCode);
        if (string.IsNullOrWhiteSpace(parentCode))
        {
            throw new ValidationException("יש לבחור קוד יחידה של הציוד הראשי");
        }

        if (!AccessorySerialCodeValidator.IsValid(dto.ParentEquipmentType, parentCode))
        {
            throw new ValidationException(
                AccessorySerialCodeValidator.InvalidMessageFor(dto.ParentEquipmentType));
        }

        var parentRegistered = await _db.AccessorySerialInventory
            .AsNoTracking()
            .AnyAsync(
                s => s.EquipmentType == dto.ParentEquipmentType && s.SerialCode == parentCode,
                cancellationToken);

        if (!parentRegistered)
        {
            throw new ValidationException(
                $"קוד {parentCode} אינו רשום במלאי עבור {LoanedEquipmentTypeLabels.GetLabel(dto.ParentEquipmentType)}");
        }

        var definition = await ResolveInventoryDefinitionAsync(dto, cancellationToken);
        if (definition.LinkedEquipmentType == dto.ParentEquipmentType)
        {
            throw new ValidationException("לא ניתן לשייך ציוד נלווה מאותו סוג כמו הציוד הראשי");
        }

        var accessoryType = definition.LinkedEquipmentType;
        var definitionId = definition.Id;
        var accessoryLabel = definition.DisplayName.Trim();

        var codes = (dto.AccessorySerialCodes ?? [])
            .Select(NormalizeCode)
            .Where(c => c.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (codes.Count == 0)
        {
            throw new ValidationException("יש לבחור לפחות קוד פריט אחד");
        }

        await ValidateAccessoryCodesRegisteredAsync(definition, accessoryType, codes, cancellationToken);

        var existingCodes = await _db.EquipmentDefaultAccessories
            .AsNoTracking()
            .Where(e => e.ParentEquipmentType == dto.ParentEquipmentType
                        && e.ParentSerialCode == parentCode
                        && e.InventoryDefinitionId == definitionId
                        && codes.Contains(e.AccessorySerialCode))
            .Select(e => e.AccessorySerialCode)
            .ToListAsync(cancellationToken);

        var existingSet = new HashSet<string>(existingCodes, StringComparer.OrdinalIgnoreCase);
        var toAdd = codes.Where(c => !existingSet.Contains(c)).ToList();

        if (toAdd.Count == 0)
        {
            throw new ValidationException("כל קודי הפריט שנבחרו כבר משויכים כציוד נלווה קבוע ליחידה זו");
        }

        var entities = toAdd.Select(code => new EquipmentDefaultAccessory
        {
            ParentEquipmentType = dto.ParentEquipmentType,
            ParentSerialCode = parentCode,
            InventoryDefinitionId = definitionId,
            AccessoryEquipmentType = accessoryType,
            AccessorySerialCode = code
        }).ToList();

        _db.EquipmentDefaultAccessories.AddRange(entities);
        await _db.SaveChangesAsync(cancellationToken);

        return entities.Select(e => Map(e, accessoryLabel)).ToList();
    }

    public async Task DeleteAsync(int id, CancellationToken cancellationToken = default)
    {
        var entity = await _db.EquipmentDefaultAccessories
            .FirstOrDefaultAsync(e => e.Id == id, cancellationToken);

        if (entity == null)
        {
            throw new ValidationException("שיוך הציוד הנלווה לא נמצא");
        }

        _db.EquipmentDefaultAccessories.Remove(entity);
        await _db.SaveChangesAsync(cancellationToken);
    }

    private async Task<InventoryDefinition> ResolveInventoryDefinitionAsync(
        CreateEquipmentDefaultAccessoriesBatchDto dto,
        CancellationToken cancellationToken)
    {
        if (dto.InventoryDefinitionId is int defId && defId > 0)
        {
            var byId = await _db.InventoryDefinitions
                .AsNoTracking()
                .FirstOrDefaultAsync(d => d.Id == defId, cancellationToken);

            if (byId == null)
            {
                throw new ValidationException("פריט המלאי שנבחר לא נמצא");
            }

            return byId;
        }

        if (dto.AccessoryEquipmentType is LoanedEquipmentType type && Enum.IsDefined(type))
        {
            var byType = await _db.InventoryDefinitions
                .AsNoTracking()
                .FirstOrDefaultAsync(d => d.LinkedEquipmentType == type, cancellationToken);

            if (byType == null)
            {
                throw new ValidationException(
                    $"לא נמצא פריט מלאי עבור {LoanedEquipmentTypeLabels.GetLabel(type)}");
            }

            return byType;
        }

        throw new ValidationException("יש לבחור סוג אביזר מהמלאי");
    }

    private async Task ValidateAccessoryCodesRegisteredAsync(
        InventoryDefinition definition,
        LoanedEquipmentType? accessoryType,
        List<string> codes,
        CancellationToken cancellationToken)
    {
        HashSet<string> registeredSet;

        if (accessoryType is LoanedEquipmentType linked)
        {
            foreach (var code in codes)
            {
                if (!AccessorySerialCodeValidator.IsValid(linked, code))
                {
                    throw new ValidationException(AccessorySerialCodeValidator.InvalidMessageFor(linked));
                }
            }

            var registeredCodes = await _db.AccessorySerialInventory
                .AsNoTracking()
                .Where(s => s.EquipmentType == linked && codes.Contains(s.SerialCode))
                .Select(s => s.SerialCode)
                .ToListAsync(cancellationToken);

            registeredSet = new HashSet<string>(registeredCodes, StringComparer.OrdinalIgnoreCase);
        }
        else
        {
            var registeredCodes = await _db.InventorySerialCodes
                .AsNoTracking()
                .Where(s => s.InventoryDefinitionId == definition.Id && codes.Contains(s.SerialCode))
                .Select(s => s.SerialCode)
                .ToListAsync(cancellationToken);

            registeredSet = new HashSet<string>(registeredCodes, StringComparer.OrdinalIgnoreCase);
        }

        var missing = codes.Where(c => !registeredSet.Contains(c)).ToList();
        if (missing.Count > 0)
        {
            throw new ValidationException(
                $"קוד פריט {missing[0]} אינו רשום במלאי עבור {definition.DisplayName.Trim()}");
        }
    }

    private static string NormalizeCode(string? code) => (code ?? string.Empty).Trim();

    private static EquipmentDefaultAccessoryDto Map(
        EquipmentDefaultAccessory entity,
        string? accessoryLabelOverride = null) =>
        new()
        {
            Id = entity.Id,
            ParentEquipmentType = entity.ParentEquipmentType,
            ParentSerialCode = entity.ParentSerialCode,
            ParentLabel = LoanedEquipmentTypeLabels.GetLabel(entity.ParentEquipmentType),
            InventoryDefinitionId = entity.InventoryDefinitionId,
            AccessoryEquipmentType = entity.AccessoryEquipmentType,
            AccessoryLabel = accessoryLabelOverride
                ?? entity.InventoryDefinition?.DisplayName?.Trim()
                ?? (entity.AccessoryEquipmentType is LoanedEquipmentType t
                    ? LoanedEquipmentTypeLabels.GetLabel(t)
                    : "אביזר"),
            AccessorySerialCode = entity.AccessorySerialCode
        };
}
