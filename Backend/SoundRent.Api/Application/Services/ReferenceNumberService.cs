using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Application.Services;

public static class ReferenceNumberKinds
{
    public const string Order = "order";
    public const string ToolLoan = "tool-loan";
    public const string BookLoan = "book-loan";
}

public interface IReferenceNumberService
{
    /// <summary>
    /// Expected id of the next row in the given table. Read-only preview: the sequence is not advanced,
    /// so a concurrent insert can still take this number before the caller saves.
    /// </summary>
    Task<int> GetNextAsync(string kind, CancellationToken cancellationToken = default);
}

public class ReferenceNumberService : IReferenceNumberService
{
    private readonly AppDbContext _db;

    public ReferenceNumberService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<int> GetNextAsync(string kind, CancellationToken cancellationToken = default)
    {
        var (tableName, maxId) = (kind ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            ReferenceNumberKinds.Order => ("Orders", await _db.Orders.MaxAsync(o => (int?)o.Id, cancellationToken)),
            ReferenceNumberKinds.ToolLoan => ("ToolLoans", await _db.ToolLoans.MaxAsync(l => (int?)l.Id, cancellationToken)),
            ReferenceNumberKinds.BookLoan => ("BookLoans", await _db.BookLoans.MaxAsync(l => (int?)l.Id, cancellationToken)),
            _ => throw new ValidationException($"Unknown reference number kind '{kind}'.")
        };

        var quotedTable = $"\"{tableName}\"";
        var sequenceNext = (await _db.Database
            .SqlQuery<long?>($"""
                SELECT COALESCE(s.last_value + s.increment_by, s.start_value) AS "Value"
                FROM pg_sequences s
                WHERE format('%I.%I', s.schemaname, s.sequencename) = pg_get_serial_sequence({quotedTable}, 'Id')
                """)
            .ToListAsync(cancellationToken))
            .FirstOrDefault();

        var fromMax = (long)(maxId ?? 0) + 1;
        var next = Math.Max(sequenceNext ?? fromMax, fromMax);
        return next > int.MaxValue ? int.MaxValue : (int)next;
    }
}
