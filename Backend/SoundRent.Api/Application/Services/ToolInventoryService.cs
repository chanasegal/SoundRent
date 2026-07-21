using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Application.Services;

public interface IToolInventoryService
{
    Task<List<ToolDefinitionDto>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<ToolDefinitionDto> CreateAsync(ToolDefinitionCreateDto dto, CancellationToken cancellationToken = default);
    Task<ToolDefinitionDto> UpdateAsync(int id, ToolDefinitionUpdateDto dto, CancellationToken cancellationToken = default);
    Task DeleteAsync(int id, CancellationToken cancellationToken = default);
    Task<ToolDefinitionDto> ReplaceSerialsAsync(int id, ToolDefinitionSerialsUpdateDto dto, CancellationToken cancellationToken = default);
    Task<List<ToolDefinitionDto>> ReplaceSerialsBatchAsync(ToolDefinitionBatchUpdateDto dto, CancellationToken cancellationToken = default);
    Task<ToolSerialLocationDto> LocateSerialAsync(
        string serialCode,
        int? toolDefinitionId = null,
        CancellationToken cancellationToken = default);
    Task<List<string>> GetAvailableSerialsAsync(IEnumerable<int> toolDefinitionIds, CancellationToken cancellationToken = default);
    /// <summary>Single-query bulk availability for all tools (AsNoTracking).</summary>
    Task<List<ToolAvailableSerialsGroupDto>> GetAllAvailableSerialsGroupedAsync(
        CancellationToken cancellationToken = default);
}

public class ToolInventoryService : IToolInventoryService
{
    private readonly AppDbContext _db;

    public ToolInventoryService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<List<ToolDefinitionDto>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var rows = await _db.ToolDefinitions
            .AsNoTracking()
            .Include(t => t.SerialCodes)
            .OrderBy(t => t.SortOrder)
            .ThenBy(t => t.Id)
            .ToListAsync(cancellationToken);

        return rows.Select(ToDto).ToList();
    }

    public async Task<ToolDefinitionDto> CreateAsync(
        ToolDefinitionCreateDto dto,
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

        if (await _db.ToolDefinitions.AnyAsync(t => t.DisplayName == displayName, cancellationToken))
        {
            throw new ValidationException($"פריט בשם \"{displayName}\" כבר קיים במלאי");
        }

        var quantity = dto.Quantity is int q && q > 0 ? Math.Min(q, 200) : 0;
        var codes = BuildSerialCodes(quantity, dto.SerialCodes);

        var maxSort = await _db.ToolDefinitions.MaxAsync(t => (int?)t.SortOrder, cancellationToken) ?? 0;
        var entity = new ToolDefinition
        {
            DisplayName = displayName,
            SortOrder = maxSort + 1,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            SerialCodes = codes
                .Select(code => new ToolSerialCode { SerialCode = code })
                .ToList()
        };

        _db.ToolDefinitions.Add(entity);
        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(entity);
    }

    public async Task<ToolDefinitionDto> UpdateAsync(
        int id,
        ToolDefinitionUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await _db.ToolDefinitions
            .Include(t => t.SerialCodes)
            .FirstOrDefaultAsync(t => t.Id == id, cancellationToken)
            ?? throw new NotFoundException("פריט המלאי לא נמצא");

        var displayName = (dto.DisplayName ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(displayName))
        {
            throw new ValidationException("יש להזין שם פריט");
        }

        if (await _db.ToolDefinitions.AnyAsync(t => t.DisplayName == displayName && t.Id != id, cancellationToken))
        {
            throw new ValidationException($"פריט בשם \"{displayName}\" כבר קיים במלאי");
        }

        entity.DisplayName = displayName;
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(entity);
    }

    public async Task DeleteAsync(int id, CancellationToken cancellationToken = default)
    {
        var entity = await _db.ToolDefinitions.FirstOrDefaultAsync(t => t.Id == id, cancellationToken)
            ?? throw new NotFoundException("פריט המלאי לא נמצא");

            var activeLoan = await _db.ToolLoanItems
            .AsNoTracking()
            .AnyAsync(
                i => i.ToolDefinitionId == id && i.ReturnedAt == null,
                cancellationToken);

        if (activeLoan)
        {
            throw new ValidationException("לא ניתן למחוק פריט עם השאלות פעילות");
        }

        _db.ToolDefinitions.Remove(entity);
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task<ToolDefinitionDto> ReplaceSerialsAsync(
        int id,
        ToolDefinitionSerialsUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await _db.ToolDefinitions
            .Include(t => t.SerialCodes)
            .FirstOrDefaultAsync(t => t.Id == id, cancellationToken)
            ?? throw new NotFoundException("פריט המלאי לא נמצא");

        ReplaceSerialCollection(entity, NormalizeCodes(dto.SerialCodes));
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(entity);
    }

    public async Task<List<ToolDefinitionDto>> ReplaceSerialsBatchAsync(
        ToolDefinitionBatchUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        var results = new List<ToolDefinitionDto>();
        await using var tx = await _db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            foreach (var item in dto.Items ?? [])
            {
                var entity = await _db.ToolDefinitions
                    .Include(t => t.SerialCodes)
                    .FirstOrDefaultAsync(t => t.Id == item.Id, cancellationToken)
                    ?? throw new NotFoundException($"פריט המלאי #{item.Id} לא נמצא");

                ReplaceSerialCollection(entity, NormalizeCodes(item.SerialCodes));
                entity.UpdatedAt = DateTime.UtcNow;
                results.Add(ToDto(entity));
            }

            await _db.SaveChangesAsync(cancellationToken);
            await tx.CommitAsync(cancellationToken);
            return results;
        }
        catch
        {
            await tx.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public async Task<ToolSerialLocationDto> LocateSerialAsync(
        string serialCode,
        int? toolDefinitionId = null,
        CancellationToken cancellationToken = default)
    {
        var code = (serialCode ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(code))
        {
            throw new ValidationException("יש להזין קוד פריט");
        }

        var serialQuery = _db.ToolSerialCodes
            .AsNoTracking()
            .Include(s => s.ToolDefinition)
            .Where(s => s.SerialCode == code);

        if (toolDefinitionId is int scopedToolId)
        {
            serialQuery = serialQuery.Where(s => s.ToolDefinitionId == scopedToolId);
        }

        var serial = await serialQuery
            .OrderBy(s => s.ToolDefinitionId)
            .FirstOrDefaultAsync(cancellationToken);

        if (serial is null)
        {
            string toolName = string.Empty;
            if (toolDefinitionId is int missingToolId)
            {
                toolName = await _db.ToolDefinitions
                    .AsNoTracking()
                    .Where(d => d.Id == missingToolId)
                    .Select(d => d.DisplayName)
                    .FirstOrDefaultAsync(cancellationToken) ?? string.Empty;
            }

            return new ToolSerialLocationDto
            {
                SerialCode = code,
                ToolName = toolName,
                ToolDefinitionId = toolDefinitionId,
                IsRegistered = false,
                IsInWarehouse = false
            };
        }

        // Loan status must match this exact tool definition + serial (codes are not globally unique).
        var active = await _db.ToolLoanItems
            .AsNoTracking()
            .Include(i => i.ToolLoan)
            .Where(i =>
                i.SerialCode == code &&
                i.ToolDefinitionId == serial.ToolDefinitionId &&
                i.ReturnedAt == null)
            .OrderByDescending(i => i.ToolLoan.LentAt)
            .FirstOrDefaultAsync(cancellationToken);

        if (active is null)
        {
            return new ToolSerialLocationDto
            {
                SerialCode = code,
                ToolName = serial.ToolDefinition.DisplayName,
                ToolDefinitionId = serial.ToolDefinitionId,
                IsRegistered = true,
                IsInWarehouse = true
            };
        }

        return new ToolSerialLocationDto
        {
            SerialCode = code,
            ToolName = serial.ToolDefinition.DisplayName,
            ToolDefinitionId = serial.ToolDefinitionId,
            IsRegistered = true,
            IsInWarehouse = false,
            LoanId = active.ToolLoanId,
            ClientName = active.ToolLoan.ClientName,
            Phone = active.ToolLoan.Phone,
            Phone2 = active.ToolLoan.Phone2,
            Address = active.ToolLoan.Address,
            Deposit = active.ToolLoan.Deposit,
            Notes = active.ToolLoan.Notes,
            HebrewLentDisplay = active.ToolLoan.HebrewLentDisplay,
            LoanDate = DateOnly.FromDateTime(active.ToolLoan.LentAt)
        };
    }

    public async Task<List<string>> GetAvailableSerialsAsync(
        IEnumerable<int> toolDefinitionIds,
        CancellationToken cancellationToken = default)
    {
        var ids = toolDefinitionIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return new List<string>();
        }

        // Cap codes to a single tool scope when one id is requested so colliding
        // serials across categories (e.g. "1" on two tools) stay independent.
        if (ids.Count == 1)
        {
            var onlyId = ids[0];
            var codes = await _db.ToolSerialCodes
                .AsNoTracking()
                .Where(s => s.ToolDefinitionId == onlyId)
                .Select(s => s.SerialCode)
                .ToListAsync(cancellationToken);

            var borrowed = await _db.ToolLoanItems
                .AsNoTracking()
                .Where(i => i.ToolDefinitionId == onlyId && i.ReturnedAt == null)
                .Select(i => i.SerialCode)
                .ToListAsync(cancellationToken);

            var borrowedSet = borrowed.ToHashSet(StringComparer.OrdinalIgnoreCase);
            return codes
                .Where(c => !borrowedSet.Contains(c))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        var allCodes = await _db.ToolSerialCodes
            .AsNoTracking()
            .Where(s => ids.Contains(s.ToolDefinitionId))
            .Select(s => new { s.ToolDefinitionId, s.SerialCode })
            .ToListAsync(cancellationToken);

        var borrowedPairs = await _db.ToolLoanItems
            .AsNoTracking()
            .Where(i => i.ReturnedAt == null && ids.Contains(i.ToolDefinitionId))
            .Select(i => new { i.ToolDefinitionId, i.SerialCode })
            .ToListAsync(cancellationToken);

        var borrowedKeys = borrowedPairs
            .Select(b => $"{b.ToolDefinitionId}|{b.SerialCode.ToLowerInvariant()}")
            .ToHashSet(StringComparer.Ordinal);

        return allCodes
            .Where(c => !borrowedKeys.Contains($"{c.ToolDefinitionId}|{c.SerialCode.ToLowerInvariant()}"))
            .Select(c => c.SerialCode)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<List<ToolAvailableSerialsGroupDto>> GetAllAvailableSerialsGroupedAsync(
        CancellationToken cancellationToken = default)
    {
        // Two AsNoTracking reads only — no per-tool round trips / connection fan-out.
        var allCodes = await _db.ToolSerialCodes
            .AsNoTracking()
            .Select(s => new { s.ToolDefinitionId, s.SerialCode })
            .ToListAsync(cancellationToken);

        var borrowedPairs = await _db.ToolLoanItems
            .AsNoTracking()
            .Where(i => i.ReturnedAt == null)
            .Select(i => new { i.ToolDefinitionId, i.SerialCode })
            .ToListAsync(cancellationToken);

        var borrowedKeys = borrowedPairs
            .Select(b => $"{b.ToolDefinitionId}|{b.SerialCode.ToLowerInvariant()}")
            .ToHashSet(StringComparer.Ordinal);

        return allCodes
            .Where(c => !borrowedKeys.Contains($"{c.ToolDefinitionId}|{c.SerialCode.ToLowerInvariant()}"))
            .GroupBy(c => c.ToolDefinitionId)
            .Select(g => new ToolAvailableSerialsGroupDto
            {
                ToolDefinitionId = g.Key,
                SerialCodes = g
                    .Select(x => x.SerialCode)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
                    .ToList()
            })
            .OrderBy(g => g.ToolDefinitionId)
            .ToList();
    }

    private static void ReplaceSerialCollection(ToolDefinition entity, List<string> codes)
    {
        entity.SerialCodes.Clear();
        foreach (var code in codes)
        {
            entity.SerialCodes.Add(new ToolSerialCode { SerialCode = code });
        }
    }

    private static List<string> BuildSerialCodes(int quantity, List<string>? provided)
    {
        var normalized = NormalizeCodes(provided);
        if (quantity <= 0)
        {
            return normalized;
        }

        while (normalized.Count < quantity)
        {
            normalized.Add((normalized.Count + 1).ToString());
        }

        return normalized.Take(quantity).ToList();
    }

    private static List<string> NormalizeCodes(IEnumerable<string>? codes)
    {
        var result = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var raw in codes ?? [])
        {
            var code = (raw ?? string.Empty).Trim();
            if (code.Length == 0 || !seen.Add(code))
            {
                continue;
            }

            if (code.Length > 100)
            {
                throw new ValidationException("קוד פריט ארוך מדי");
            }

            result.Add(code);
        }

        return result;
    }

    private static ToolDefinitionDto ToDto(ToolDefinition entity)
    {
        var codes = entity.SerialCodes
            .Select(s => s.SerialCode)
            .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new ToolDefinitionDto
        {
            Id = entity.Id,
            DisplayName = entity.DisplayName,
            SortOrder = entity.SortOrder,
            TotalQuantity = codes.Count,
            SerialCodes = codes
        };
    }
}
