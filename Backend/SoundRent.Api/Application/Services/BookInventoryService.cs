using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Application.Services;

public interface IBookInventoryService
{
    Task<List<BookDto>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<BookDto> CreateAsync(BookCreateDto dto, CancellationToken cancellationToken = default);
    Task<BookDto> UpdateAsync(int id, BookUpdateDto dto, CancellationToken cancellationToken = default);
    Task DeleteAsync(int id, CancellationToken cancellationToken = default);
    Task<BookDto> ReplaceSerialsAsync(int id, BookCopiesUpdateDto dto, CancellationToken cancellationToken = default);
    Task<List<BookDto>> ReplaceSerialsBatchAsync(BookBatchUpdateDto dto, CancellationToken cancellationToken = default);
    Task<BookCopyLocationDto> LocateSerialAsync(
        string copyNumber,
        int? bookId = null,
        CancellationToken cancellationToken = default);
    Task<List<string>> GetAvailableSerialsAsync(IEnumerable<int> bookIds, CancellationToken cancellationToken = default);
    /// <summary>Single-query bulk availability for all tools (AsNoTracking).</summary>
    Task<List<BookAvailableCopiesGroupDto>> GetAllAvailableSerialsGroupedAsync(
        CancellationToken cancellationToken = default);
}

public class BookInventoryService : IBookInventoryService
{
    private readonly AppDbContext _db;

    public BookInventoryService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<List<BookDto>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var rows = await _db.Books
            .AsNoTracking()
            .Include(t => t.Copies)
            .OrderBy(t => t.SortOrder)
            .ThenBy(t => t.Id)
            .ToListAsync(cancellationToken);

        return rows.Select(ToDto).ToList();
    }

    public async Task<BookDto> CreateAsync(
        BookCreateDto dto,
        CancellationToken cancellationToken = default)
    {
        var displayName = (dto.Title ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(displayName))
        {
            throw new ValidationException("יש להזין שם ספר");
        }

        if (displayName.Length > 200)
        {
            throw new ValidationException("שם הספר ארוך מדי");
        }

        if (await _db.Books.AnyAsync(t => t.Title == displayName, cancellationToken))
        {
            throw new ValidationException($"פריט בשם \"{displayName}\" כבר קיים במלאי");
        }

        var quantity = dto.Quantity is int q && q > 0 ? Math.Min(q, 200) : 0;
        var codes = BuildCopies(quantity, dto.Copies);

        var maxSort = await _db.Books.MaxAsync(t => (int?)t.SortOrder, cancellationToken) ?? 0;
        var entity = new Book
        {
            Title = displayName,
            Author = string.IsNullOrWhiteSpace(dto.Author) ? null : dto.Author.Trim(),
            Category = string.IsNullOrWhiteSpace(dto.Category) ? null : dto.Category.Trim(),
            SortOrder = maxSort + 1,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            Copies = codes
                .Select(code => new BookCopy { CopyNumber = code })
                .ToList()
        };

        _db.Books.Add(entity);
        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(entity);
    }

    public async Task<BookDto> UpdateAsync(
        int id,
        BookUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await _db.Books
            .Include(t => t.Copies)
            .FirstOrDefaultAsync(t => t.Id == id, cancellationToken)
            ?? throw new NotFoundException("הספר לא נמצא");

        var displayName = (dto.Title ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(displayName))
        {
            throw new ValidationException("יש להזין שם ספר");
        }

        if (await _db.Books.AnyAsync(t => t.Title == displayName && t.Id != id, cancellationToken))
        {
            throw new ValidationException($"פריט בשם \"{displayName}\" כבר קיים במלאי");
        }

        entity.Title = displayName;
        entity.Author = string.IsNullOrWhiteSpace(dto.Author) ? null : dto.Author.Trim();
        entity.Category = string.IsNullOrWhiteSpace(dto.Category) ? null : dto.Category.Trim();
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(entity);
    }

    public async Task DeleteAsync(int id, CancellationToken cancellationToken = default)
    {
        var entity = await _db.Books.FirstOrDefaultAsync(t => t.Id == id, cancellationToken)
            ?? throw new NotFoundException("הספר לא נמצא");

            var activeLoan = await _db.BookLoanItems
            .AsNoTracking()
            .AnyAsync(
                i => i.BookId == id && i.ReturnedAt == null,
                cancellationToken);

        if (activeLoan)
        {
            throw new ValidationException("לא ניתן למחוק פריט עם השאלות פעילות");
        }

        _db.Books.Remove(entity);
        await _db.SaveChangesAsync(cancellationToken);
    }

    public async Task<BookDto> ReplaceSerialsAsync(
        int id,
        BookCopiesUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await _db.Books
            .Include(t => t.Copies)
            .FirstOrDefaultAsync(t => t.Id == id, cancellationToken)
            ?? throw new NotFoundException("הספר לא נמצא");

        ReplaceSerialCollection(entity, NormalizeCodes(dto.Copies));
        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(entity);
    }

    public async Task<List<BookDto>> ReplaceSerialsBatchAsync(
        BookBatchUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        var results = new List<BookDto>();
        await using var tx = await _db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            foreach (var item in dto.Items ?? [])
            {
                var entity = await _db.Books
                    .Include(t => t.Copies)
                    .FirstOrDefaultAsync(t => t.Id == item.Id, cancellationToken)
                    ?? throw new NotFoundException($"הספר #{item.Id} לא נמצא");

                ReplaceSerialCollection(entity, NormalizeCodes(item.Copies));
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

    public async Task<BookCopyLocationDto> LocateSerialAsync(
        string copyNumber,
        int? bookId = null,
        CancellationToken cancellationToken = default)
    {
        var code = (copyNumber ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(code))
        {
            throw new ValidationException("יש להזין קוד עותק");
        }

        var serialQuery = _db.BookCopies
            .AsNoTracking()
            .Include(s => s.Book)
            .Where(s => s.CopyNumber == code);

        if (bookId is int scopedToolId)
        {
            serialQuery = serialQuery.Where(s => s.BookId == scopedToolId);
        }

        var serial = await serialQuery
            .OrderBy(s => s.BookId)
            .FirstOrDefaultAsync(cancellationToken);

        if (serial is null)
        {
            string toolName = string.Empty;
            if (bookId is int missingToolId)
            {
                toolName = await _db.Books
                    .AsNoTracking()
                    .Where(d => d.Id == missingToolId)
                    .Select(d => d.Title)
                    .FirstOrDefaultAsync(cancellationToken) ?? string.Empty;
            }

            return new BookCopyLocationDto
            {
                CopyNumber = code,
                BookTitle = toolName,
                BookId = bookId,
                IsRegistered = false,
                IsInWarehouse = false
            };
        }

        // Loan status must match this exact tool definition + serial (codes are not globally unique).
        var active = await _db.BookLoanItems
            .AsNoTracking()
            .Include(i => i.BookLoan)
            .Where(i =>
                i.CopyNumber == code &&
                i.BookId == serial.BookId &&
                i.ReturnedAt == null)
            .OrderByDescending(i => i.BookLoan.LentAt)
            .FirstOrDefaultAsync(cancellationToken);

        if (active is null)
        {
            return new BookCopyLocationDto
            {
                CopyNumber = code,
                BookTitle = serial.Book.Title,
                BookId = serial.BookId,
                IsRegistered = true,
                IsInWarehouse = true
            };
        }

        return new BookCopyLocationDto
        {
            CopyNumber = code,
            BookTitle = serial.Book.Title,
            BookId = serial.BookId,
            IsRegistered = true,
            IsInWarehouse = false,
            LoanId = active.BookLoanId,
            ClientName = active.BookLoan.ClientName,
            Phone = active.BookLoan.Phone
        };
    }

    public async Task<List<string>> GetAvailableSerialsAsync(
        IEnumerable<int> bookIds,
        CancellationToken cancellationToken = default)
    {
        var ids = bookIds.Distinct().ToList();
        if (ids.Count == 0)
        {
            return new List<string>();
        }

        // Cap codes to a single tool scope when one id is requested so colliding
        // copies across categories (e.g. "1" on two tools) stay independent.
        if (ids.Count == 1)
        {
            var onlyId = ids[0];
            var codes = await _db.BookCopies
                .AsNoTracking()
                .Where(s => s.BookId == onlyId)
                .Select(s => s.CopyNumber)
                .ToListAsync(cancellationToken);

            var borrowed = await _db.BookLoanItems
                .AsNoTracking()
                .Where(i => i.BookId == onlyId && i.ReturnedAt == null)
                .Select(i => i.CopyNumber)
                .ToListAsync(cancellationToken);

            var borrowedSet = borrowed.ToHashSet(StringComparer.OrdinalIgnoreCase);
            return codes
                .Where(c => !borrowedSet.Contains(c))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
                .ToList();
        }

        var allCodes = await _db.BookCopies
            .AsNoTracking()
            .Where(s => ids.Contains(s.BookId))
            .Select(s => new { s.BookId, s.CopyNumber })
            .ToListAsync(cancellationToken);

        var borrowedPairs = await _db.BookLoanItems
            .AsNoTracking()
            .Where(i => i.ReturnedAt == null && ids.Contains(i.BookId))
            .Select(i => new { i.BookId, i.CopyNumber })
            .ToListAsync(cancellationToken);

        var borrowedKeys = borrowedPairs
            .Select(b => $"{b.BookId}|{b.CopyNumber.ToLowerInvariant()}")
            .ToHashSet(StringComparer.Ordinal);

        return allCodes
            .Where(c => !borrowedKeys.Contains($"{c.BookId}|{c.CopyNumber.ToLowerInvariant()}"))
            .Select(c => c.CopyNumber)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task<List<BookAvailableCopiesGroupDto>> GetAllAvailableSerialsGroupedAsync(
        CancellationToken cancellationToken = default)
    {
        // Two AsNoTracking reads only — no per-tool round trips / connection fan-out.
        var allCodes = await _db.BookCopies
            .AsNoTracking()
            .Select(s => new { s.BookId, s.CopyNumber })
            .ToListAsync(cancellationToken);

        var borrowedPairs = await _db.BookLoanItems
            .AsNoTracking()
            .Where(i => i.ReturnedAt == null)
            .Select(i => new { i.BookId, i.CopyNumber })
            .ToListAsync(cancellationToken);

        var borrowedKeys = borrowedPairs
            .Select(b => $"{b.BookId}|{b.CopyNumber.ToLowerInvariant()}")
            .ToHashSet(StringComparer.Ordinal);

        return allCodes
            .Where(c => !borrowedKeys.Contains($"{c.BookId}|{c.CopyNumber.ToLowerInvariant()}"))
            .GroupBy(c => c.BookId)
            .Select(g => new BookAvailableCopiesGroupDto
            {
                BookId = g.Key,
                Copies = g
                    .Select(x => x.CopyNumber)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
                    .ToList()
            })
            .OrderBy(g => g.BookId)
            .ToList();
    }

    private static void ReplaceSerialCollection(Book entity, List<string> codes)
    {
        entity.Copies.Clear();
        foreach (var code in codes)
        {
            entity.Copies.Add(new BookCopy { CopyNumber = code });
        }
    }

    private static List<string> BuildCopies(int quantity, List<string>? provided)
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
                throw new ValidationException("קוד עותק ארוך מדי");
            }

            result.Add(code);
        }

        return result;
    }

    private static BookDto ToDto(Book entity)
    {
        var codes = entity.Copies
            .Select(s => s.CopyNumber)
            .OrderBy(c => c, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new BookDto
        {
            Id = entity.Id,
            Title = entity.Title,
            Author = entity.Author,
            Category = entity.Category,
            SortOrder = entity.SortOrder,
            TotalQuantity = codes.Count,
            Copies = codes
        };
    }
}
