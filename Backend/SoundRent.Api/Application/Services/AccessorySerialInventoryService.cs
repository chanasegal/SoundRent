using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Mapping;
using SoundRent.Api.Application.Validation;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Application.Services;

public class AccessorySerialInventoryService : IAccessorySerialInventoryService
{
    private readonly IAccessorySerialInventoryRepository _repository;

    public AccessorySerialInventoryService(IAccessorySerialInventoryRepository repository)
    {
        _repository = repository;
    }

    public async Task<List<AccessoryInventoryGroupDto>> GetAllGroupedAsync(CancellationToken cancellationToken = default)
    {
        var rows = await _repository.GetAllOrderedAsync(cancellationToken);
        return rows
            .GroupBy(r => r.EquipmentType)
            .OrderBy(g => (int)g.Key)
            .Select(g => ToGroupDto(g.Key, g.Select(r => r.SerialCode).ToList()))
            .ToList();
    }

    public async Task<AccessoryInventoryGroupDto> UpdateTypeAsync(
        LoanedEquipmentType equipmentType,
        AccessoryInventoryUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        var normalized = NormalizeCodes(equipmentType, dto.SerialCodes);
        await _repository.ReplaceCodesForTypeAsync(equipmentType, normalized, cancellationToken);
        await _repository.SaveChangesAsync(cancellationToken);
        return ToGroupDto(equipmentType, normalized);
    }

    public async Task<List<AccessoryInventoryGroupDto>> UpdateAllAsync(
        AccessoryInventoryBatchUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        var updates = new Dictionary<LoanedEquipmentType, IReadOnlyCollection<string>>();
        foreach (var item in dto.Items ?? [])
        {
            updates[item.EquipmentType] = NormalizeCodes(item.EquipmentType, item.SerialCodes);
        }

        await _repository.ReplaceAllTypesAsync(updates, cancellationToken);
        await _repository.SaveChangesAsync(cancellationToken);

        return updates
            .OrderBy(kv => (int)kv.Key)
            .Select(kv => ToGroupDto(kv.Key, kv.Value.ToList()))
            .ToList();
    }

    public async Task<List<AccessorySerialAvailabilityGroupDto>> GetAvailabilityAsync(
        AccessorySerialAvailabilityRequestDto request,
        CancellationToken cancellationToken = default)
    {
        var dates = ParseDates(request.Dates);
        var shifts = request.Shifts?.Count > 0 ? request.Shifts : null;
        var allRows = await _repository.GetAllOrderedAsync(cancellationToken);
        var grouped = allRows.GroupBy(r => r.EquipmentType).ToList();
        var bookedByType = await _repository.GetBookedSerialCodesByTypesAsync(
            dates,
            shifts,
            request.ExcludeOrderId,
            cancellationToken);

        return grouped
            .Select(group =>
            {
                bookedByType.TryGetValue(group.Key, out var booked);
                booked ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                return new AccessorySerialAvailabilityGroupDto
                {
                    EquipmentType = group.Key,
                    Options = group
                        .Select(r => r.SerialCode)
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
                        .Select(code => new AccessorySerialOptionDto
                        {
                            SerialCode = code,
                            IsAvailable = !booked.Contains(code)
                        })
                        .ToList()
                };
            })
            .OrderBy(r => (int)r.EquipmentType)
            .ToList();
    }

    public async Task ValidateOrderLoanedSerialsAsync(
        IReadOnlyCollection<OrderLoanedEquipmentDto> items,
        IReadOnlyCollection<OrderShiftDto> shifts,
        int? excludeOrderId,
        CancellationToken cancellationToken = default)
    {
        var dates = shifts
            .Select(s => s.OrderDate)
            .Distinct()
            .ToList();

        if (dates.Count == 0)
        {
            return;
        }

        var inventoryRows = await _repository.GetAllOrderedAsync(cancellationToken);
        var inventoryByType = inventoryRows
            .GroupBy(r => r.EquipmentType)
            .ToDictionary(
                g => g.Key,
                g => g.Select(r => r.SerialCode.Trim())
                    .ToHashSet(StringComparer.OrdinalIgnoreCase));

        var bookedByType = await _repository.GetBookedSerialCodesByTypesAsync(
            dates,
            shifts,
            excludeOrderId,
            cancellationToken);

        foreach (var item in items)
        {
            if (item.IsCustomItem || item.Quantity <= 0 || item.LoanedEquipmentType is not LoanedEquipmentType type)
            {
                continue;
            }

            inventoryByType.TryGetValue(type, out var allowedCodes);
            allowedCodes ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            var selectedCodes = (item.Notes ?? [])
                .OrderBy(n => n.Ordinal)
                .Select(n => (n.Content ?? string.Empty).Trim())
                .Where(c => c.Length > 0)
                .ToList();

            if (selectedCodes.Count != item.Quantity)
            {
                var label = LoanedEquipmentTypeLabels.GetLabel(type);
                throw new ValidationException($"יש לבחור קוד לכל יחידה עבור \"{label}\"");
            }

            if (selectedCodes.Distinct(StringComparer.OrdinalIgnoreCase).Count() != selectedCodes.Count)
            {
                var label = LoanedEquipmentTypeLabels.GetLabel(type);
                throw new ValidationException($"לא ניתן לבחור את אותו קוד פעמיים עבור \"{label}\"");
            }

            foreach (var code in selectedCodes)
            {
                if (!AccessorySerialCodeValidator.IsValid(type, code))
                {
                    throw new ValidationException(AccessorySerialCodeValidator.InvalidMessageFor(type));
                }

                if (!allowedCodes.Contains(code))
                {
                    var label = LoanedEquipmentTypeLabels.GetLabel(type);
                    throw new ValidationException($"הקוד \"{code}\" אינו רשום במלאי עבור \"{label}\"");
                }
            }

            bookedByType.TryGetValue(type, out var booked);
            booked ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var code in selectedCodes)
            {
                if (booked.Contains(code))
                {
                    var label = LoanedEquipmentTypeLabels.GetLabel(type);
                    throw new ValidationException($"הקוד \"{code}\" כבר משויך להזמנה אחרת בתאריך זה ({label})");
                }
            }
        }
    }

    private static AccessoryInventoryGroupDto ToGroupDto(LoanedEquipmentType type, List<string> codes) => new()
    {
        EquipmentType = type,
        Label = LoanedEquipmentTypeLabels.GetLabel(type),
        TotalQuantity = codes.Count,
        SerialCodes = codes
    };

    private static List<string> NormalizeCodes(LoanedEquipmentType equipmentType, IEnumerable<string> rawCodes)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var result = new List<string>();

        foreach (var raw in rawCodes)
        {
            var trimmed = (raw ?? string.Empty).Trim();
            if (trimmed.Length == 0)
            {
                continue;
            }

            if (!AccessorySerialCodeValidator.IsValid(equipmentType, trimmed))
            {
                throw new ValidationException(AccessorySerialCodeValidator.InvalidMessageFor(equipmentType));
            }

            if (!seen.Add(trimmed))
            {
                continue;
            }

            result.Add(trimmed);
        }

        return result.OrderBy(c => c, StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static List<DateOnly> ParseDates(IEnumerable<string> rawDates)
    {
        var result = new List<DateOnly>();
        foreach (var raw in rawDates)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                continue;
            }

            if (DateOnly.TryParse(raw.Trim(), out var date))
            {
                result.Add(date);
            }
        }

        return result.Distinct().ToList();
    }
}
