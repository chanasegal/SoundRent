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
        var typesFilter = request.EquipmentTypes?.Count > 0
            ? request.EquipmentTypes.Distinct().ToList()
            : null;

        var inventoryByType = await _repository.GetSerialCodesGroupedAsync(typesFilter, cancellationToken);
        var loanedOutByType = await _repository.GetLoanedOutCodesGroupedAsync(typesFilter, cancellationToken);
        var reservedByType = request.ExcludeOrderId is int orderId
            ? await _repository.GetAssignedCodesForOrderAsync(orderId, typesFilter, cancellationToken)
            : new Dictionary<LoanedEquipmentType, HashSet<string>>();

        return inventoryByType
            .OrderBy(kv => (int)kv.Key)
            .Select(kv =>
            {
                loanedOutByType.TryGetValue(kv.Key, out var loanedOut);
                loanedOut ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                reservedByType.TryGetValue(kv.Key, out var reserved);
                reserved ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                return new AccessorySerialAvailabilityGroupDto
                {
                    EquipmentType = kv.Key,
                    Options = kv.Value
                        .Distinct(StringComparer.OrdinalIgnoreCase)
                        .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
                        .Select(code => new AccessorySerialOptionDto
                        {
                            SerialCode = code,
                            IsAvailable = !loanedOut.Contains(code) || reserved.Contains(code)
                        })
                        .ToList()
                };
            })
            .ToList();
    }

    public async Task<AccessorySerialLocationDto> GetSerialCodeLocationAsync(
        LoanedEquipmentType equipmentType,
        string serialCode,
        CancellationToken cancellationToken = default)
    {
        var trimmed = (serialCode ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            throw new ValidationException("יש להזין קוד סידורי לחיפוש");
        }

        if (!AccessorySerialCodeValidator.IsValid(equipmentType, trimmed))
        {
            throw new ValidationException(AccessorySerialCodeValidator.InvalidMessageFor(equipmentType));
        }

        var label = LoanedEquipmentTypeLabels.GetLabel(equipmentType);
        var location = await _repository.GetSerialCodeLocationAsync(equipmentType, trimmed, cancellationToken);
        if (location is null)
        {
            return new AccessorySerialLocationDto
            {
                EquipmentType = equipmentType,
                Label = label,
                SerialCode = trimmed,
                IsRegistered = false,
                IsInWarehouse = true
            };
        }

        return new AccessorySerialLocationDto
        {
            EquipmentType = equipmentType,
            Label = label,
            SerialCode = location.SerialCode,
            IsRegistered = true,
            IsInWarehouse = location.PhysicalStatus == AccessorySerialPhysicalStatus.InWarehouse,
            OrderId = location.ActiveOrderId,
            CustomerName = location.CustomerName,
            Phone = location.Phone
        };
    }

    public async Task ValidateOrderLoanedSerialsAsync(
        IReadOnlyCollection<OrderLoanedEquipmentDto> items,
        IReadOnlyCollection<OrderShiftDto> shifts,
        int? excludeOrderId,
        CancellationToken cancellationToken = default)
    {
        var typesNeeded = items
            .Where(i => !i.IsCustomItem && i.Quantity > 0 && i.LoanedEquipmentType is not null)
            .Select(i => i.LoanedEquipmentType!.Value)
            .Distinct()
            .ToList();

        if (typesNeeded.Count == 0)
        {
            return;
        }

        var inventoryByType = await _repository.GetSerialCodesGroupedAsync(typesNeeded, cancellationToken);
        var loanedOutByType = await _repository.GetLoanedOutCodesGroupedAsync(typesNeeded, cancellationToken);
        var reservedByType = excludeOrderId is int orderId
            ? await _repository.GetAssignedCodesForOrderAsync(orderId, typesNeeded, cancellationToken)
            : new Dictionary<LoanedEquipmentType, HashSet<string>>();

        foreach (var item in items)
        {
            if (item.IsCustomItem || item.Quantity <= 0 || item.LoanedEquipmentType is not LoanedEquipmentType type)
            {
                continue;
            }

            inventoryByType.TryGetValue(type, out var allowedList);
            var allowedCodes = allowedList is null
                ? new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                : allowedList.Select(c => c.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);

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
                var label = LoanedEquipmentTypeLabels.GetLabel(type);
                throw new ValidationException($"יש לבחור קוד לכל יחידה עבור \"{label}\"");
            }

            if (selectedCodes.Select(n => n.Code).Distinct(StringComparer.OrdinalIgnoreCase).Count() != selectedCodes.Count)
            {
                var label = LoanedEquipmentTypeLabels.GetLabel(type);
                throw new ValidationException($"לא ניתן לבחור את אותו קוד פעמיים עבור \"{label}\"");
            }

            foreach (var entry in selectedCodes)
            {
                if (!AccessorySerialCodeValidator.IsValid(type, entry.Code))
                {
                    throw new ValidationException(AccessorySerialCodeValidator.InvalidMessageFor(type));
                }

                if (!allowedCodes.Contains(entry.Code))
                {
                    var label = LoanedEquipmentTypeLabels.GetLabel(type);
                    throw new ValidationException($"הקוד \"{entry.Code}\" אינו רשום במלאי עבור \"{label}\"");
                }
            }

            loanedOutByType.TryGetValue(type, out var loanedOut);
            loanedOut ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            reservedByType.TryGetValue(type, out var reserved);
            reserved ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var entry in selectedCodes.Where(n => !n.IsReturned))
            {
                if (loanedOut.Contains(entry.Code) && !reserved.Contains(entry.Code))
                {
                    var label = LoanedEquipmentTypeLabels.GetLabel(type);
                    throw new ValidationException(
                        $"הקוד \"{entry.Code}\" כרגע בחוץ (מושאל) ואינו זמין לבחירה ({label})");
                }
            }
        }
    }

    public async Task SyncPhysicalStatusForOrderAsync(
        int orderId,
        IReadOnlyDictionary<LoanedEquipmentType, HashSet<string>> priorAssignedByType,
        IReadOnlyCollection<OrderLoanedEquipmentDto> items,
        CancellationToken cancellationToken = default)
    {
        var nextAssignedByType = ExtractAssignedCodesByType(items);
        var allTypes = priorAssignedByType.Keys
            .Concat(nextAssignedByType.Keys)
            .Distinct()
            .ToList();

        foreach (var type in allTypes)
        {
            priorAssignedByType.TryGetValue(type, out var prior);
            prior ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            nextAssignedByType.TryGetValue(type, out var next);
            next ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            foreach (var code in prior.Except(next, StringComparer.OrdinalIgnoreCase))
            {
                await _repository.SetPhysicalStatusAsync(
                    type,
                    code,
                    AccessorySerialPhysicalStatus.InWarehouse,
                    cancellationToken);
            }

            foreach (var code in next.Except(prior, StringComparer.OrdinalIgnoreCase))
            {
                await _repository.SetPhysicalStatusAsync(
                    type,
                    code,
                    AccessorySerialPhysicalStatus.LoanedOut,
                    cancellationToken);
            }
        }
    }

    public async Task ReleaseReturnedSerialsAsync(
        IReadOnlyCollection<(LoanedEquipmentType EquipmentType, string SerialCode)> returnedCodes,
        CancellationToken cancellationToken = default)
    {
        foreach (var (type, code) in returnedCodes)
        {
            await _repository.SetPhysicalStatusAsync(
                type,
                code,
                AccessorySerialPhysicalStatus.InWarehouse,
                cancellationToken);
        }
    }

    public async Task ReleaseAllOrderSerialsAsync(int orderId, CancellationToken cancellationToken = default)
    {
        var assigned = await _repository.GetAssignedCodesForOrderAsync(orderId, cancellationToken: cancellationToken);
        foreach (var (type, codes) in assigned)
        {
            foreach (var code in codes)
            {
                await _repository.SetPhysicalStatusAsync(
                    type,
                    code,
                    AccessorySerialPhysicalStatus.InWarehouse,
                    cancellationToken);
            }
        }
    }

    public async Task ValidateReturnedSerialGuardrailsAsync(
        int orderId,
        bool isReturnProcessed,
        IReadOnlyDictionary<LoanedEquipmentType, HashSet<string>> existingReturnedByType,
        IReadOnlyCollection<OrderLoanedEquipmentDto> incomingItems,
        CancellationToken cancellationToken = default)
    {
        if (existingReturnedByType.Count == 0 && !isReturnProcessed)
        {
            return;
        }

        var activeOwners = existingReturnedByType.Count > 0
            ? await _repository.GetActiveSerialOwnersAsync(orderId, cancellationToken)
            : new Dictionary<(LoanedEquipmentType Type, string Code), int>();

        var incomingByType = incomingItems
            .Where(i => !i.IsCustomItem && i.LoanedEquipmentType is not null)
            .ToDictionary(i => i.LoanedEquipmentType!.Value, i => i);

        foreach (var (type, returnedCodes) in existingReturnedByType)
        {
            incomingByType.TryGetValue(type, out var incomingLine);
            var incomingNotes = incomingLine?.Notes ?? [];

            foreach (var code in returnedCodes)
            {
                var preserved = incomingNotes.Any(note =>
                    string.Equals((note.Content ?? string.Empty).Trim(), code, StringComparison.OrdinalIgnoreCase));

                if (preserved)
                {
                    continue;
                }

                var label = LoanedEquipmentTypeLabels.GetLabel(type);
                if (activeOwners.TryGetValue((type, code), out var ownerOrderId))
                {
                    throw new ValidationException(
                        $"הקוד \"{code}\" הוחזר מהזמנה זו והוקצה מחדש להזמנה #{ownerOrderId} — לא ניתן לשנות או להסיר אותו ({label})");
                }

                throw new ValidationException(
                    $"הקוד \"{code}\" הוחזר למחסן ולא ניתן לשנות או להסיר אותו ({label})");
            }
        }

        if (!isReturnProcessed)
        {
            return;
        }

        foreach (var (type, returnedCodes) in existingReturnedByType)
        {
            foreach (var code in returnedCodes)
            {
                if (activeOwners.ContainsKey((type, code)))
                {
                    continue;
                }

                incomingByType.TryGetValue(type, out var incomingLine);
                var stillPresent = (incomingLine?.Notes ?? []).Any(note =>
                    string.Equals((note.Content ?? string.Empty).Trim(), code, StringComparison.OrdinalIgnoreCase));

                if (!stillPresent)
                {
                    var label = LoanedEquipmentTypeLabels.GetLabel(type);
                    throw new ValidationException(
                        $"ההזמנה כוללת רישום החזרה שמור — לא ניתן לשנות קודים שהוחזרו למחסן (\"{code}\", {label})");
                }
            }
        }
    }

    private static Dictionary<LoanedEquipmentType, HashSet<string>> ExtractAssignedCodesByType(
        IReadOnlyCollection<OrderLoanedEquipmentDto> items)
    {
        var result = new Dictionary<LoanedEquipmentType, HashSet<string>>();
        foreach (var item in items)
        {
            if (item.IsCustomItem || item.Quantity <= 0 || item.LoanedEquipmentType is not LoanedEquipmentType type)
            {
                continue;
            }

            if (!result.TryGetValue(type, out var codes))
            {
                codes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                result[type] = codes;
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
}
