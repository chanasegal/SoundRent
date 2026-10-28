using Microsoft.EntityFrameworkCore;
using Npgsql;
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
    Task<ToolTypeLocationDto> LocateByTypeAsync(int toolDefinitionId, CancellationToken cancellationToken = default);
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

        var requiresCode = dto.RequiresCode;
        var quantity = dto.Quantity is int q && q > 0 ? Math.Min(q, 200) : 0;
        var codes = requiresCode ? BuildSerialCodes(quantity, dto.SerialCodes) : [];
        if (requiresCode)
        {
            quantity = codes.Count;
        }

        var maxSort = await _db.ToolDefinitions.MaxAsync(t => (int?)t.SortOrder, cancellationToken) ?? 0;
        var entity = new ToolDefinition
        {
            DisplayName = displayName,
            SortOrder = maxSort + 1,
            Quantity = quantity,
            RequiresCode = requiresCode,
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

        try
        {
            var codes = NormalizeCodes(dto.SerialCodes);
            ReplaceSerialCollection(entity, codes);
            entity.RequiresCode = true;
            entity.Quantity = codes.Count;
            entity.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync(cancellationToken);
            return ToDto(entity);
        }
        catch (DbUpdateException ex) when (IsUniqueConstraintViolation(ex))
        {
            throw new ValidationException("קוד פריט כפול — בדקו שאין קודים כפולים לאותו כלי");
        }
    }

    public async Task<List<ToolDefinitionDto>> ReplaceSerialsBatchAsync(
        ToolDefinitionBatchUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        if (dto is null)
        {
            throw new ValidationException("גוף הבקשה חסר או לא תקין");
        }

        var items = dto.Items ?? [];
        if (items.Count == 0)
        {
            throw new ValidationException("לא נשלחו פריטים לעדכון");
        }

        const int maxItems = 500;
        if (items.Count > maxItems)
        {
            throw new ValidationException($"ניתן לעדכן עד {maxItems} פריטים בבת אחת");
        }

        var seenIds = new HashSet<int>();
        var ids = new List<int>(items.Count);
        var normalizedById = new Dictionary<int, (string? DisplayName, bool? RequiresCode, int? Quantity, List<string>? Codes)>(items.Count);
        var totalCodes = 0;

        foreach (var item in items)
        {
            if (item is null)
            {
                throw new ValidationException("פריט בבקשה אינו תקין");
            }

            if (item.Id <= 0)
            {
                throw new ValidationException($"מזהה פריט לא תקין: {item.Id}");
            }

            if (!seenIds.Add(item.Id))
            {
                throw new ValidationException($"פריט #{item.Id} מופיע יותר מפעם אחת בבקשה");
            }

            string? displayName = null;
            if (item.DisplayName is not null)
            {
                displayName = item.DisplayName.Trim();
                if (string.IsNullOrEmpty(displayName))
                {
                    throw new ValidationException($"פריט #{item.Id}: יש להזין שם פריט");
                }

                if (displayName.Length > 200)
                {
                    throw new ValidationException($"פריט #{item.Id}: שם הפריט ארוך מדי");
                }
            }

            List<string>? codes = null;
            try
            {
                // Null RequiresCode means "keep existing"; treat as code-tracked for validation of sent serials.
                if (item.RequiresCode != false)
                {
                    codes = NormalizeCodes(item.SerialCodes);
                }
                else
                {
                    codes = [];
                }
            }
            catch (ValidationException ex)
            {
                throw new ValidationException($"פריט #{item.Id}: {ex.Message}");
            }

            totalCodes += codes?.Count ?? 0;
            const int maxTotalCodes = 10_000;
            if (totalCodes > maxTotalCodes)
            {
                throw new ValidationException("מספר קודי הפריטים גדול מדי — פצלו את העדכון למנות קטנות יותר");
            }

            ids.Add(item.Id);
            normalizedById[item.Id] = (displayName, item.RequiresCode, item.Quantity, codes);
        }

        // NpgsqlRetryingExecutionStrategy requires user transactions to run inside ExecuteAsync.
        var strategy = _db.Database.CreateExecutionStrategy();
        return await strategy.ExecuteAsync(async () =>
        {
            // Clear any leftover tracking if a prior attempt was retried.
            _db.ChangeTracker.Clear();

            await using var tx = await _db.Database.BeginTransactionAsync(cancellationToken);
            try
            {
                // Single round-trip instead of N+1 per item (avoids long transactions / timeouts).
                var entities = await _db.ToolDefinitions
                    .Include(t => t.SerialCodes)
                    .Where(t => ids.Contains(t.Id))
                    .ToListAsync(cancellationToken);

                var byId = entities.ToDictionary(e => e.Id);
                var missing = ids.Where(id => !byId.ContainsKey(id)).ToList();
                if (missing.Count > 0)
                {
                    throw new NotFoundException(
                        missing.Count == 1
                            ? $"פריט המלאי #{missing[0]} לא נמצא"
                            : $"פריטי המלאי הבאים לא נמצאו: {string.Join(", ", missing)}");
                }

                var results = new List<ToolDefinitionDto>(items.Count);
                var now = DateTime.UtcNow;
                foreach (var id in ids)
                {
                    var entity = byId[id];
                    var (displayName, requiresCodeOpt, quantityOpt, codesOpt) = normalizedById[id];
                    if (displayName is not null
                        && !string.Equals(entity.DisplayName, displayName, StringComparison.Ordinal))
                    {
                        var nameTaken = await _db.ToolDefinitions.AnyAsync(
                            t => t.DisplayName == displayName && t.Id != id,
                            cancellationToken);
                        if (nameTaken)
                        {
                            throw new ValidationException($"פריט בשם \"{displayName}\" כבר קיים במלאי");
                        }

                        entity.DisplayName = displayName;
                    }

                    var requiresCode = requiresCodeOpt ?? entity.RequiresCode;
                    List<string> codes;
                    int quantity;
                    if (requiresCode)
                    {
                        codes = codesOpt ?? NormalizeCodes(null);
                        if (quantityOpt is int requestedQty && requestedQty > 0 && codes.Count == 0)
                        {
                            codes = BuildSerialCodes(Math.Min(200, requestedQty), null);
                        }
                        quantity = codes.Count;
                    }
                    else
                    {
                        codes = [];
                        quantity = quantityOpt is int q
                            ? Math.Max(0, Math.Min(200, q))
                            : entity.Quantity;
                    }

                    entity.RequiresCode = requiresCode;
                    entity.Quantity = quantity;
                    ReplaceSerialCollection(entity, codes);
                    entity.UpdatedAt = now;
                    results.Add(ToDto(entity));
                }

                await _db.SaveChangesAsync(cancellationToken);
                await tx.CommitAsync(cancellationToken);
                return results;
            }
            catch (DbUpdateException ex) when (IsUniqueConstraintViolation(ex))
            {
                await tx.RollbackAsync(cancellationToken);
                throw new ValidationException("קוד פריט כפול — בדקו שאין קודים כפולים לאותו כלי");
            }
            catch
            {
                await tx.RollbackAsync(cancellationToken);
                throw;
            }
        });
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

        var normalizedCode = code.ToLowerInvariant();
        var serialQuery = _db.ToolSerialCodes
            .AsNoTracking()
            .Include(s => s.ToolDefinition)
            .Where(s => s.SerialCode.ToLower() == normalizedCode);

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
                i.SerialCode.ToLower() == normalizedCode &&
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
            HebrewLentDisplay = active.AddedAt == active.ToolLoan.LentAt ? active.ToolLoan.HebrewLentDisplay : null,
            LoanDate = DateOnly.FromDateTime(active.AddedAt)
        };
    }

    public async Task<ToolTypeLocationDto> LocateByTypeAsync(
        int toolDefinitionId,
        CancellationToken cancellationToken = default)
    {
        var def = await _db.ToolDefinitions
            .AsNoTracking()
            .Include(d => d.SerialCodes)
            .FirstOrDefaultAsync(d => d.Id == toolDefinitionId, cancellationToken)
            ?? throw new NotFoundException("הפריט לא נמצא");

        var totalQuantity = def.RequiresCode
            ? def.SerialCodes.Count
            : Math.Max(0, def.Quantity);

        var activeItems = await _db.ToolLoanItems
            .AsNoTracking()
            .Include(i => i.ToolLoan)
            .Where(i => i.ToolDefinitionId == toolDefinitionId && i.ReturnedAt == null)
            .OrderByDescending(i => i.ToolLoan.LentAt)
            .ToListAsync(cancellationToken);

        var holders = activeItems
            .GroupBy(i => i.ToolLoanId)
            .Select(g =>
            {
                var loan = g.First().ToolLoan;
                var firstAdded = g.Min(i => i.AddedAt);
                return new ToolTypeHolderDto
                {
                    LoanId = g.Key,
                    Quantity = g.Count(),
                    ClientName = loan.ClientName,
                    Phone = loan.Phone,
                    Phone2 = loan.Phone2,
                    Address = loan.Address,
                    Deposit = loan.Deposit,
                    Notes = loan.Notes,
                    HebrewLentDisplay = firstAdded == loan.LentAt ? loan.HebrewLentDisplay : null,
                    LoanDate = DateOnly.FromDateTime(firstAdded)
                };
            })
            .OrderByDescending(h => h.LoanDate)
            .ThenByDescending(h => h.LoanId)
            .ToList();

        var loanedQuantity = activeItems.Count;
        return new ToolTypeLocationDto
        {
            ToolDefinitionId = def.Id,
            ToolName = def.DisplayName,
            RequiresCode = def.RequiresCode,
            TotalQuantity = totalQuantity,
            LoanedQuantity = loanedQuantity,
            AvailableQuantity = Math.Max(0, totalQuantity - loanedQuantity),
            Holders = holders
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
                .OrderBy(c => c, NumericStringComparer.Instance)
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
            .OrderBy(c => c, NumericStringComparer.Instance)
            .ToList();
    }

    public async Task<List<ToolAvailableSerialsGroupDto>> GetAllAvailableSerialsGroupedAsync(
        CancellationToken cancellationToken = default)
    {
        // AsNoTracking reads only — no per-tool round trips / connection fan-out.
        var definitions = await _db.ToolDefinitions
            .AsNoTracking()
            .Select(d => new { d.Id, d.RequiresCode, d.Quantity })
            .ToListAsync(cancellationToken);

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

        var borrowedCountByDef = borrowedPairs
            .GroupBy(b => b.ToolDefinitionId)
            .ToDictionary(g => g.Key, g => g.Count());

        var availableSerialsByDef = allCodes
            .Where(c => !borrowedKeys.Contains($"{c.ToolDefinitionId}|{c.SerialCode.ToLowerInvariant()}"))
            .GroupBy(c => c.ToolDefinitionId)
            .ToDictionary(
                g => g.Key,
                g => g
                    .Select(x => x.SerialCode)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(c => c, NumericStringComparer.Instance)
                    .ToList());

        return definitions
            .Select(d =>
            {
                availableSerialsByDef.TryGetValue(d.Id, out var serials);
                serials ??= [];
                borrowedCountByDef.TryGetValue(d.Id, out var borrowed);
                var availableQuantity = d.RequiresCode
                    ? serials.Count
                    : Math.Max(0, d.Quantity - borrowed);

                return new ToolAvailableSerialsGroupDto
                {
                    ToolDefinitionId = d.Id,
                    SerialCodes = serials,
                    AvailableQuantity = availableQuantity
                };
            })
            .OrderBy(g => g.ToolDefinitionId)
            .ToList();
    }

    /// <summary>
    /// Sync serials in place. Avoids Clear()+re-Add which can INSERT before DELETE
    /// and trip the unique index on (ToolDefinitionId, SerialCode).
    /// </summary>
    private static void ReplaceSerialCollection(ToolDefinition entity, List<string> codes)
    {
        var desired = new HashSet<string>(codes, StringComparer.OrdinalIgnoreCase);

        foreach (var existing in entity.SerialCodes.Where(s => !desired.Contains(s.SerialCode)).ToList())
        {
            entity.SerialCodes.Remove(existing);
        }

        var remaining = entity.SerialCodes
            .ToDictionary(s => s.SerialCode, StringComparer.OrdinalIgnoreCase);

        foreach (var code in codes)
        {
            if (remaining.TryGetValue(code, out var row))
            {
                if (!string.Equals(row.SerialCode, code, StringComparison.Ordinal))
                {
                    row.SerialCode = code;
                }
            }
            else
            {
                entity.SerialCodes.Add(new ToolSerialCode { SerialCode = code });
            }
        }
    }

    private static bool IsUniqueConstraintViolation(DbUpdateException ex)
    {
        return ex.InnerException is PostgresException pg
            && pg.SqlState == PostgresErrorCodes.UniqueViolation;
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
            .OrderBy(c => c, NumericStringComparer.Instance)
            .ToList();

        return new ToolDefinitionDto
        {
            Id = entity.Id,
            DisplayName = entity.DisplayName,
            SortOrder = entity.SortOrder,
            TotalQuantity = entity.RequiresCode
                ? Math.Max(entity.Quantity, codes.Count)
                : Math.Max(0, entity.Quantity),
            RequiresCode = entity.RequiresCode,
            SerialCodes = codes
        };
    }
}
