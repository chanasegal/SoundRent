using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.PhoneNumbers;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Infrastructure.Repositories;

public class CustomerRepository : ICustomerRepository
{
    private readonly AppDbContext _db;

    public CustomerRepository(AppDbContext db)
    {
        _db = db;
    }

    public Task<Customer?> GetByPhone1Async(string phone1Digits, CancellationToken cancellationToken = default)
    {
        return WithSystems(_db.Customers.AsNoTracking())
            .FirstOrDefaultAsync(c => c.Phone1 == phone1Digits, cancellationToken);
    }

    public Task<Customer?> GetTrackedByPhone1Async(string phone1Digits, CancellationToken cancellationToken = default)
    {
        return WithSystems(_db.Customers)
            .FirstOrDefaultAsync(c => c.Phone1 == phone1Digits, cancellationToken);
    }

    public Task<List<Customer>> GetAllAsync(
        SystemType? systemType = null,
        CancellationToken cancellationToken = default)
    {
        var query = WithSystems(_db.Customers.AsNoTracking());
        if (systemType.HasValue)
        {
            query = query.Where(c => c.Systems.Any(s => s.SystemType == systemType.Value));
        }

        return query
            .OrderBy(c => c.FullName ?? string.Empty)
            .ThenBy(c => c.Phone1)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<Customer>> SearchAsync(
        string? query,
        SystemType? systemType = null,
        CancellationToken cancellationToken = default)
    {
        var q = (query ?? string.Empty).Trim();
        var baseQuery = WithSystems(_db.Customers.AsNoTracking());

        if (systemType.HasValue)
        {
            baseQuery = baseQuery.Where(c => c.Systems.Any(s => s.SystemType == systemType.Value));
        }

        if (q.Length == 0)
        {
            return await baseQuery
                .OrderByDescending(c => c.UpdatedAt)
                .ThenBy(c => c.Phone1)
                .Take(500)
                .ToListAsync(cancellationToken);
        }

        baseQuery = ApplySplitSearchFilter(baseQuery, q);

        return await baseQuery
            .OrderByDescending(c => c.UpdatedAt)
            .ThenBy(c => c.Phone1)
            .Take(200)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<CustomerSuggestRow>> SearchSuggestAsync(
        string? query,
        SystemType? systemType = null,
        CancellationToken cancellationToken = default)
    {
        var q = (query ?? string.Empty).Trim();
        if (q.Length < 2)
        {
            return [];
        }

        // No Include(Systems) — project only fields needed for typeahead.
        IQueryable<Customer> baseQuery = _db.Customers.AsNoTracking();

        if (systemType.HasValue)
        {
            baseQuery = baseQuery.Where(c => c.Systems.Any(s => s.SystemType == systemType.Value));
        }

        baseQuery = ApplySplitSearchFilter(baseQuery, q);

        return await baseQuery
            .OrderByDescending(c => c.UpdatedAt)
            .ThenBy(c => c.Phone1)
            .Take(10)
            .Select(c => new CustomerSuggestRow
            {
                Phone1 = c.Phone1,
                Phone2 = c.Phone2,
                FullName = c.FullName,
                Address = c.Address
            })
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// Digits-only → phone prefix/exact (no name OR).
    /// Otherwise → FullName substring only.
    /// </summary>
    private static IQueryable<Customer> ApplySplitSearchFilter(IQueryable<Customer> query, string q)
    {
        if (IsDigitsOnlyQuery(q))
        {
            var digits = PhoneNumberNormalizer.DigitsOnly(q);
            if (digits.Length < 2)
            {
                return query.Where(_ => false);
            }

            // Exact PK / Phone2 match when the query looks like a full Israeli number.
            if (PhoneNumberNormalizer.IsValidIsraeliPhone(digits))
            {
                return query.Where(c =>
                    c.Phone1 == digits || (c.Phone2 != null && c.Phone2 == digits));
            }

            // Prefix match → SQL LIKE 'term%' (B-tree friendly on Phone1 PK).
            return query.Where(c =>
                c.Phone1.StartsWith(digits) || (c.Phone2 != null && c.Phone2.StartsWith(digits)));
        }

        return query.Where(c => c.FullName != null && c.FullName.Contains(q));
    }

    private static bool IsDigitsOnlyQuery(string q)
    {
        var hasDigit = false;
        foreach (var c in q)
        {
            if (char.IsDigit(c))
            {
                hasDigit = true;
                continue;
            }

            if (c is ' ' or '-' or '(' or ')' or '+')
            {
                continue;
            }

            return false;
        }

        return hasDigit;
    }

    public async Task UpsertAsync(Customer customer, CancellationToken cancellationToken = default)
    {
        var tracked = await _db.Customers
            .Include(c => c.Systems)
            .FirstOrDefaultAsync(c => c.Phone1 == customer.Phone1, cancellationToken);

        if (tracked is null)
        {
            await _db.Customers.AddAsync(customer, cancellationToken);
            return;
        }

        tracked.Phone2 = customer.Phone2;
        tracked.FullName = customer.FullName;
        tracked.Address = customer.Address;
        tracked.Notes = customer.Notes;
        tracked.UpdatedAt = customer.UpdatedAt;
    }

    public async Task UpdateFieldsAsync(Customer customer, CancellationToken cancellationToken = default)
    {
        var tracked = await _db.Customers
            .FirstOrDefaultAsync(c => c.Phone1 == customer.Phone1, cancellationToken)
            ?? throw new InvalidOperationException($"Customer {customer.Phone1} was not found for update.");

        tracked.Phone2 = customer.Phone2;
        tracked.FullName = customer.FullName;
        tracked.Address = customer.Address;
        tracked.Notes = customer.Notes;
        tracked.UpdatedAt = customer.UpdatedAt;
    }

    public async Task EnsureSystemLinkAsync(
        string phone1Digits,
        SystemType systemType,
        CancellationToken cancellationToken = default)
    {
        var exists = await _db.CustomerSystems.AnyAsync(
            cs => cs.CustomerPhone1 == phone1Digits && cs.SystemType == systemType,
            cancellationToken);
        if (exists)
        {
            return;
        }

        await _db.CustomerSystems.AddAsync(
            new CustomerSystem
            {
                CustomerPhone1 = phone1Digits,
                SystemType = systemType,
                LinkedAt = DateTime.UtcNow
            },
            cancellationToken);
    }

    public async Task ReplacePhone1WithCascadeAsync(
        string oldPhone1,
        Customer updated,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await _db.Database.BeginTransactionAsync(cancellationToken);
        try
        {
            await _db.Orders
                .Where(o => o.Phone == oldPhone1)
                .ExecuteUpdateAsync(
                    s => s.SetProperty(o => o.Phone, updated.Phone1),
                    cancellationToken);

            await _db.WaitlistEntries
                .Where(w => w.Phone == oldPhone1)
                .ExecuteUpdateAsync(
                    s => s.SetProperty(w => w.Phone, updated.Phone1),
                    cancellationToken);

            var existingLinks = await _db.CustomerSystems
                .Where(cs => cs.CustomerPhone1 == oldPhone1)
                .ToListAsync(cancellationToken);

            var existing = await _db.Customers
                .FirstOrDefaultAsync(c => c.Phone1 == oldPhone1, cancellationToken)
                ?? throw new InvalidOperationException($"Customer {oldPhone1} was not found for phone change.");

            _db.CustomerSystems.RemoveRange(existingLinks);
            _db.Customers.Remove(existing);
            await _db.SaveChangesAsync(cancellationToken);

            await _db.Customers.AddAsync(updated, cancellationToken);
            foreach (var link in existingLinks)
            {
                await _db.CustomerSystems.AddAsync(
                    new CustomerSystem
                    {
                        CustomerPhone1 = updated.Phone1,
                        SystemType = link.SystemType,
                        LinkedAt = link.LinkedAt
                    },
                    cancellationToken);
            }

            await _db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }

    public void Remove(Customer customer)
    {
        _db.Customers.Remove(customer);
    }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return _db.SaveChangesAsync(cancellationToken);
    }

    private static IQueryable<Customer> WithSystems(IQueryable<Customer> query) =>
        query.Include(c => c.Systems);
}
