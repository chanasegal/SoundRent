using ClosedXML.Excel;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Infrastructure.Data;
using System.Globalization;
using System.Text;

namespace SoundRent.Api.Application.Services;

public interface IBookInventoryService
{
    Task<List<BookDto>> GetAllAsync(CancellationToken cancellationToken = default);
    Task<BookDto> CreateAsync(BookCreateDto dto, CancellationToken cancellationToken = default);
    Task<BookDto> UpdateAsync(int id, BookUpdateDto dto, CancellationToken cancellationToken = default);
    Task DeleteAsync(int id, CancellationToken cancellationToken = default);
    Task<BookDto> ReplaceSerialsAsync(int id, BookCopiesUpdateDto dto, CancellationToken cancellationToken = default);
    Task<List<BookDto>> ReplaceSerialsBatchAsync(BookBatchUpdateDto dto, CancellationToken cancellationToken = default);
    Task<BookImportResultDto> ImportFromFileAsync(IFormFile file, CancellationToken cancellationToken = default);
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

    public async Task<BookImportResultDto> ImportFromFileAsync(
        IFormFile file,
        CancellationToken cancellationToken = default)
    {
        if (file == null || file.Length == 0)
        {
            throw new ValidationException("יש לבחור קובץ לייבוא");
        }

        var extension = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (extension is not (".xlsx" or ".xlsm" or ".csv"))
        {
            throw new ValidationException("ניתן לייבא קבצי Excel (.xlsx) או CSV בלבד");
        }

        List<ImportRow> rows;
        await using (var stream = file.OpenReadStream())
        {
            rows = extension == ".csv"
                ? ParseCsvRows(stream)
                : ParseExcelRows(stream);
        }

        if (rows.Count == 0)
        {
            return new BookImportResultDto
            {
                ImportedCount = 0,
                SkippedCount = 0,
                Message = "לא נמצאו שורות תקינות לייבוא"
            };
        }

        var grouped = new Dictionary<string, ImportRow>(StringComparer.OrdinalIgnoreCase);
        var skipped = 0;
        foreach (var row in rows)
        {
            var title = row.Title.Trim();
            if (title.Length == 0 || title.Length > 200)
            {
                skipped++;
                continue;
            }

            if (grouped.TryGetValue(title, out var existing))
            {
                foreach (var code in row.Copies)
                {
                    if (!existing.Copies.Contains(code, StringComparer.OrdinalIgnoreCase))
                    {
                        existing.Copies.Add(code);
                    }
                }

                if (row.Quantity is int q && q > (existing.Quantity ?? 0))
                {
                    existing.Quantity = q;
                }
            }
            else
            {
                grouped[title] = new ImportRow
                {
                    Title = title,
                    Quantity = row.Quantity,
                    Copies = new List<string>(row.Copies)
                };
            }
        }

        var existingTitles = await _db.Books
            .AsNoTracking()
            .Select(b => b.Title)
            .ToListAsync(cancellationToken);
        var existingSet = new HashSet<string>(existingTitles, StringComparer.OrdinalIgnoreCase);

        var toCreate = new List<Book>();
        var maxSort = await _db.Books.MaxAsync(t => (int?)t.SortOrder, cancellationToken) ?? 0;
        var now = DateTime.UtcNow;

        foreach (var row in grouped.Values)
        {
            if (existingSet.Contains(row.Title))
            {
                skipped++;
                continue;
            }

            var quantity = row.Quantity is int q && q > 0 ? Math.Min(q, 200) : 0;
            List<string> codes;
            try
            {
                codes = BuildCopies(quantity, row.Copies);
            }
            catch (ValidationException)
            {
                skipped++;
                continue;
            }

            maxSort++;
            toCreate.Add(new Book
            {
                Title = row.Title,
                SortOrder = maxSort,
                CreatedAt = now,
                UpdatedAt = now,
                Copies = codes.Select(code => new BookCopy { CopyNumber = code }).ToList()
            });
            existingSet.Add(row.Title);
        }

        if (toCreate.Count > 0)
        {
            await _db.Books.AddRangeAsync(toCreate, cancellationToken);
            await _db.SaveChangesAsync(cancellationToken);
        }

        return new BookImportResultDto
        {
            ImportedCount = toCreate.Count,
            SkippedCount = skipped,
            Message = toCreate.Count == 0
                ? "לא יובאו ספרים חדשים"
                : $"ייבוא הושלם בהצלחה! הוכנסו {toCreate.Count} ספרים"
        };
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
            Phone = active.BookLoan.Phone,
            Phone2 = active.BookLoan.Phone2,
            Address = active.BookLoan.Address,
            Deposit = active.BookLoan.Deposit,
            Notes = active.BookLoan.Notes,
            HebrewLentDisplay = active.BookLoan.HebrewLentDisplay,
            LoanDate = DateOnly.FromDateTime(active.BookLoan.LentAt)
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

    private static List<ImportRow> ParseExcelRows(Stream stream)
    {
        using var workbook = new XLWorkbook(stream);
        var worksheet = workbook.Worksheets.FirstOrDefault()
            ?? throw new ValidationException("הקובץ אינו מכיל גיליון נתונים");

        var used = worksheet.RangeUsed();
        if (used == null)
        {
            return [];
        }

        var firstRow = used.FirstRow().RowNumber();
        var lastRow = used.LastRow().RowNumber();
        var firstCol = used.FirstColumn().ColumnNumber();
        var lastCol = used.LastColumn().ColumnNumber();

        var headers = new Dictionary<int, string>();
        for (var col = firstCol; col <= lastCol; col++)
        {
            var header = worksheet.Cell(firstRow, col).GetString().Trim();
            if (header.Length > 0)
            {
                headers[col] = header;
            }
        }

        if (headers.Count == 0)
        {
            throw new ValidationException("חסרה שורת כותרות בקובץ");
        }

        var map = ResolveColumnMapByIndex(headers);
        if (map.TitleCol == null)
        {
            throw new ValidationException("חסרה עמודת ספר / שם ספר בקובץ");
        }

        var rows = new List<ImportRow>();
        for (var r = firstRow + 1; r <= lastRow; r++)
        {
            string Cell(int? col) =>
                col is int c ? worksheet.Cell(r, c).GetFormattedString().Trim() : string.Empty;

            var title = Cell(map.TitleCol);
            if (string.IsNullOrWhiteSpace(title))
            {
                continue;
            }

            rows.Add(BuildImportRow(title, Cell(map.QuantityCol), Cell(map.BarcodeCol)));
        }

        return rows;
    }

    private static List<ImportRow> ParseCsvRows(Stream stream)
    {
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        var lines = new List<string>();
        while (reader.ReadLine() is { } line)
        {
            lines.Add(line);
        }

        if (lines.Count == 0)
        {
            return [];
        }

        var delimiter = DetectCsvDelimiter(lines[0]);
        var headerCells = SplitCsvLine(lines[0], delimiter);
        var headers = new Dictionary<int, string>();
        for (var i = 0; i < headerCells.Count; i++)
        {
            var header = headerCells[i].Trim().Trim('"');
            if (header.Length > 0)
            {
                headers[i + 1] = header;
            }
        }

        var map = ResolveColumnMapByIndex(headers);
        if (map.TitleCol == null)
        {
            throw new ValidationException("חסרה עמודת ספר / שם ספר בקובץ");
        }

        var rows = new List<ImportRow>();
        for (var i = 1; i < lines.Count; i++)
        {
            if (string.IsNullOrWhiteSpace(lines[i]))
            {
                continue;
            }

            var cells = SplitCsvLine(lines[i], delimiter);
            string Cell(int? col)
            {
                if (col is not int c || c < 1 || c > cells.Count)
                {
                    return string.Empty;
                }

                return cells[c - 1].Trim().Trim('"');
            }

            var title = Cell(map.TitleCol);
            if (string.IsNullOrWhiteSpace(title))
            {
                continue;
            }

            rows.Add(BuildImportRow(title, Cell(map.QuantityCol), Cell(map.BarcodeCol)));
        }

        return rows;
    }

    private static ImportRow BuildImportRow(string title, string quantityRaw, string barcodeRaw)
    {
        int? quantity = null;
        if (!string.IsNullOrWhiteSpace(quantityRaw)
            && int.TryParse(quantityRaw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var q)
            && q > 0)
        {
            quantity = Math.Min(q, 200);
        }

        var copies = new List<string>();
        if (!string.IsNullOrWhiteSpace(barcodeRaw))
        {
            foreach (var part in barcodeRaw.Split([',', ';', '|'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                if (part.Length > 0 && part.Length <= 100)
                {
                    copies.Add(part);
                }
            }
        }

        return new ImportRow
        {
            Title = title.Trim(),
            Quantity = quantity,
            Copies = copies
        };
    }

    private static ColumnMap ResolveColumnMapByIndex(Dictionary<int, string> headers)
    {
        var map = new ColumnMap();
        foreach (var (col, rawHeader) in headers)
        {
            var header = NormalizeHeader(rawHeader);
            if (IsTitleHeader(header))
            {
                map.TitleCol ??= col;
            }
            else if (IsQuantityHeader(header))
            {
                map.QuantityCol ??= col;
            }
            else if (IsBarcodeHeader(header))
            {
                map.BarcodeCol ??= col;
            }
        }

        return map;
    }

    private static string NormalizeHeader(string header) =>
        header.Trim().ToLowerInvariant().Replace(" ", string.Empty).Replace("_", string.Empty);

    private static bool IsTitleHeader(string h) =>
        h is "ספר" or "שםספר" or "title" or "book" or "booktitle";

    private static bool IsQuantityHeader(string h) =>
        h is "כמות" or "quantity" or "qty";

    private static bool IsBarcodeHeader(string h) =>
        h is "ברקוד" or "barcode" or "barcodes";

    private static char DetectCsvDelimiter(string headerLine)
    {
        var commas = headerLine.Count(c => c == ',');
        var semis = headerLine.Count(c => c == ';');
        var tabs = headerLine.Count(c => c == '\t');
        if (tabs >= commas && tabs >= semis && tabs > 0)
        {
            return '\t';
        }

        return semis > commas ? ';' : ',';
    }

    private static List<string> SplitCsvLine(string line, char delimiter)
    {
        var result = new List<string>();
        var current = new StringBuilder();
        var inQuotes = false;
        for (var i = 0; i < line.Length; i++)
        {
            var ch = line[i];
            if (ch == '"')
            {
                if (inQuotes && i + 1 < line.Length && line[i + 1] == '"')
                {
                    current.Append('"');
                    i++;
                }
                else
                {
                    inQuotes = !inQuotes;
                }

                continue;
            }

            if (ch == delimiter && !inQuotes)
            {
                result.Add(current.ToString());
                current.Clear();
                continue;
            }

            current.Append(ch);
        }

        result.Add(current.ToString());
        return result;
    }

    private sealed class ImportRow
    {
        public string Title { get; set; } = string.Empty;
        public int? Quantity { get; set; }
        public List<string> Copies { get; set; } = new();
    }

    private sealed class ColumnMap
    {
        public int? TitleCol { get; set; }
        public int? QuantityCol { get; set; }
        public int? BarcodeCol { get; set; }
    }
}
