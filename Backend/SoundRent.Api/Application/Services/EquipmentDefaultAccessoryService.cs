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

        var rows = await _db.EquipmentDefaultAccessories
            .AsNoTracking()
            .Where(e => e.ParentEquipmentType == parentEquipmentType
                        && e.ParentSerialCode == parentCode)
            .OrderBy(e => e.AccessoryEquipmentType)
            .ThenBy(e => e.AccessorySerialCode)
            .ToListAsync(cancellationToken);

        return rows.Select(Map).ToList();
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

        if (!Enum.IsDefined(dto.AccessoryEquipmentType))
        {
            throw new ValidationException("סוג אביזר אינו תקין");
        }

        if (dto.AccessoryEquipmentType == dto.ParentEquipmentType)
        {
            throw new ValidationException("לא ניתן לשייך ציוד נלווה מאותו סוג כמו הציוד הראשי");
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

        var codes = (dto.AccessorySerialCodes ?? [])
            .Select(NormalizeCode)
            .Where(c => c.Length > 0)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (codes.Count == 0)
        {
            throw new ValidationException("יש לבחור לפחות קוד פריט אחד");
        }

        foreach (var code in codes)
        {
            if (!AccessorySerialCodeValidator.IsValid(dto.AccessoryEquipmentType, code))
            {
                throw new ValidationException(
                    AccessorySerialCodeValidator.InvalidMessageFor(dto.AccessoryEquipmentType));
            }
        }

        var registeredCodes = await _db.AccessorySerialInventory
            .AsNoTracking()
            .Where(s => s.EquipmentType == dto.AccessoryEquipmentType && codes.Contains(s.SerialCode))
            .Select(s => s.SerialCode)
            .ToListAsync(cancellationToken);

        var registeredSet = new HashSet<string>(registeredCodes, StringComparer.OrdinalIgnoreCase);
        var missing = codes.Where(c => !registeredSet.Contains(c)).ToList();
        if (missing.Count > 0)
        {
            var label = LoanedEquipmentTypeLabels.GetLabel(dto.AccessoryEquipmentType);
            throw new ValidationException(
                $"קוד פריט {missing[0]} אינו רשום במלאי עבור {label}");
        }

        var existingCodes = await _db.EquipmentDefaultAccessories
            .AsNoTracking()
            .Where(e => e.ParentEquipmentType == dto.ParentEquipmentType
                        && e.ParentSerialCode == parentCode
                        && e.AccessoryEquipmentType == dto.AccessoryEquipmentType
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
            AccessoryEquipmentType = dto.AccessoryEquipmentType,
            AccessorySerialCode = code
        }).ToList();

        _db.EquipmentDefaultAccessories.AddRange(entities);
        await _db.SaveChangesAsync(cancellationToken);

        return entities.Select(Map).ToList();
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

    private static string NormalizeCode(string? code) => (code ?? string.Empty).Trim();

    private static EquipmentDefaultAccessoryDto Map(EquipmentDefaultAccessory entity) =>
        new()
        {
            Id = entity.Id,
            ParentEquipmentType = entity.ParentEquipmentType,
            ParentSerialCode = entity.ParentSerialCode,
            ParentLabel = LoanedEquipmentTypeLabels.GetLabel(entity.ParentEquipmentType),
            AccessoryEquipmentType = entity.AccessoryEquipmentType,
            AccessoryLabel = LoanedEquipmentTypeLabels.GetLabel(entity.AccessoryEquipmentType),
            AccessorySerialCode = entity.AccessorySerialCode
        };
}
