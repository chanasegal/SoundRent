using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Application.Services;

public interface IToolLoanService
{
    Task<List<ToolLoanDto>> GetActiveAsync(CancellationToken cancellationToken = default);
    Task<List<ToolLoanDto>> GetAllAsync(bool? returnedOnly = null, CancellationToken cancellationToken = default);
    Task<ToolLoanDto> CreateAsync(ToolLoanCreateDto dto, CancellationToken cancellationToken = default);
    Task<ToolLoanDto> MarkReturnedAsync(int id, ToolLoanReturnDto dto, CancellationToken cancellationToken = default);
    Task<ToolLoanDto> MarkItemReturnedAsync(
        int loanId,
        int itemId,
        ToolLoanReturnDto dto,
        CancellationToken cancellationToken = default);
}

public class ToolLoanService : IToolLoanService
{
    private readonly AppDbContext _db;

    public ToolLoanService(AppDbContext db)
    {
        _db = db;
    }

    public Task<List<ToolLoanDto>> GetActiveAsync(CancellationToken cancellationToken = default)
        => GetAllAsync(returnedOnly: false, cancellationToken);

    public async Task<List<ToolLoanDto>> GetAllAsync(
        bool? returnedOnly = null,
        CancellationToken cancellationToken = default)
    {
        var query = _db.ToolLoans
            .AsNoTracking()
            .Include(l => l.Items)
            .AsQueryable();

        if (returnedOnly == true)
        {
            // Fully returned loans (every item returned, or legacy loan-level stamp).
            query = query.Where(l =>
                l.ReturnedAt != null ||
                (l.Items.Count > 0 && l.Items.All(i => i.ReturnedAt != null)));
        }
        else if (returnedOnly == false)
        {
            // Still has at least one open item.
            query = query.Where(l => l.Items.Any(i => i.ReturnedAt == null));
        }

        var rows = await query
            .OrderByDescending(l => l.LentAt)
            .ThenByDescending(l => l.Id)
            .ToListAsync(cancellationToken);

        return rows.Select(ToDto).ToList();
    }

    public async Task<ToolLoanDto> CreateAsync(
        ToolLoanCreateDto dto,
        CancellationToken cancellationToken = default)
    {
        var phone = (dto.Phone ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(phone))
        {
            throw new ValidationException("יש להזין מספר טלפון");
        }

        var items = dto.Items ?? [];
        if (items.Count == 0)
        {
            throw new ValidationException("יש לבחור לפחות כלי אחד להשאלה");
        }

        var normalizedItems = new List<(int ToolDefinitionId, string SerialCode, string ToolName)>();
        var seenCodes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var item in items)
        {
            var serial = (item.SerialCode ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(serial))
            {
                throw new ValidationException("קוד פריט חסר");
            }

            if (!seenCodes.Add(serial))
            {
                throw new ValidationException($"קוד פריט {serial} נבחר יותר מפעם אחת");
            }

            var definition = await _db.ToolDefinitions
                .AsNoTracking()
                .Include(t => t.SerialCodes)
                .FirstOrDefaultAsync(t => t.Id == item.ToolDefinitionId, cancellationToken)
                ?? throw new ValidationException($"סוג כלי #{item.ToolDefinitionId} לא נמצא");

            if (!definition.SerialCodes.Any(s => string.Equals(s.SerialCode, serial, StringComparison.OrdinalIgnoreCase)))
            {
                throw new ValidationException($"קוד {serial} אינו שייך ל־{definition.DisplayName}");
            }

            var alreadyOut = await _db.ToolLoanItems
                .AsNoTracking()
                .AnyAsync(
                    i => i.SerialCode == serial &&
                         i.ToolDefinitionId == definition.Id &&
                         i.ReturnedAt == null,
                    cancellationToken);

            if (alreadyOut)
            {
                throw new ValidationException($"קוד {serial} כבר מושאל");
            }

            normalizedItems.Add((definition.Id, serial, definition.DisplayName));
        }

        var entity = new ToolLoan
        {
            LentAt = DateTime.UtcNow,
            HebrewLentDisplay = (dto.HebrewLentDisplay ?? string.Empty).Trim(),
            ClientName = (dto.ClientName ?? string.Empty).Trim(),
            Phone = phone,
            Deposit = string.IsNullOrWhiteSpace(dto.Deposit) ? null : dto.Deposit.Trim(),
            Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim(),
            DeadlineAt = dto.DeadlineAt,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            Items = normalizedItems
                .Select(i => new ToolLoanItem
                {
                    ToolDefinitionId = i.ToolDefinitionId,
                    ToolName = i.ToolName,
                    SerialCode = i.SerialCode
                })
                .ToList()
        };

        _db.ToolLoans.Add(entity);
        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(entity);
    }

    public async Task<ToolLoanDto> MarkReturnedAsync(
        int id,
        ToolLoanReturnDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await _db.ToolLoans
            .Include(l => l.Items)
            .FirstOrDefaultAsync(l => l.Id == id, cancellationToken)
            ?? throw new NotFoundException("ההשאלה לא נמצאה");

        var stamp = DateTime.UtcNow;
        var hebrew = (dto.HebrewReturnedDisplay ?? string.Empty).Trim();

        foreach (var item in entity.Items.Where(i => i.ReturnedAt == null))
        {
            item.ReturnedAt = stamp;
            item.HebrewReturnedDisplay = hebrew;
        }

        entity.ReturnedAt = stamp;
        entity.HebrewReturnedDisplay = hebrew;
        entity.UpdatedAt = stamp;
        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(entity);
    }

    public async Task<ToolLoanDto> MarkItemReturnedAsync(
        int loanId,
        int itemId,
        ToolLoanReturnDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await _db.ToolLoans
            .Include(l => l.Items)
            .FirstOrDefaultAsync(l => l.Id == loanId, cancellationToken)
            ?? throw new NotFoundException("ההשאלה לא נמצאה");

        var item = entity.Items.FirstOrDefault(i => i.Id == itemId)
            ?? throw new NotFoundException("פריט ההשאלה לא נמצא");

        if (item.ReturnedAt == null)
        {
            var stamp = DateTime.UtcNow;
            var hebrew = (dto.HebrewReturnedDisplay ?? string.Empty).Trim();
            item.ReturnedAt = stamp;
            item.HebrewReturnedDisplay = hebrew;
            entity.UpdatedAt = stamp;

            if (entity.Items.All(i => i.ReturnedAt != null))
            {
                entity.ReturnedAt = stamp;
                entity.HebrewReturnedDisplay = hebrew;
            }

            await _db.SaveChangesAsync(cancellationToken);
        }

        return ToDto(entity);
    }

    private static ToolLoanDto ToDto(ToolLoan entity)
    {
        return new ToolLoanDto
        {
            Id = entity.Id,
            LentAt = entity.LentAt,
            HebrewLentDisplay = entity.HebrewLentDisplay,
            ClientName = entity.ClientName,
            Phone = entity.Phone,
            Deposit = entity.Deposit,
            Notes = entity.Notes,
            DeadlineAt = entity.DeadlineAt,
            ReturnedAt = entity.ReturnedAt,
            HebrewReturnedDisplay = entity.HebrewReturnedDisplay,
            Items = entity.Items
                .OrderBy(i => i.Id)
                .Select(i => new ToolLoanItemDto
                {
                    Id = i.Id,
                    ToolDefinitionId = i.ToolDefinitionId,
                    ToolName = i.ToolName,
                    SerialCode = i.SerialCode,
                    ReturnedAt = i.ReturnedAt,
                    HebrewReturnedDisplay = i.HebrewReturnedDisplay
                })
                .ToList()
        };
    }
}
