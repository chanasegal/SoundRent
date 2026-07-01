using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.PhoneNumbers;
using SoundRent.Api.Domain.Entities;
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
        return _db.Customers.AsNoTracking().FirstOrDefaultAsync(c => c.Phone1 == phone1Digits, cancellationToken);
    }

    public Task<Customer?> GetTrackedByPhone1Async(string phone1Digits, CancellationToken cancellationToken = default)
    {
        return _db.Customers.FirstOrDefaultAsync(c => c.Phone1 == phone1Digits, cancellationToken);
    }

    public Task<List<Customer>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        return _db.Customers
            .AsNoTracking()
            .OrderBy(c => c.FullName ?? string.Empty)
            .ThenBy(c => c.Phone1)
            .ToListAsync(cancellationToken);
    }

    public async Task<List<Customer>> SearchAsync(string? query, CancellationToken cancellationToken = default)
    {
        var q = (query ?? string.Empty).Trim();
        if (q.Length == 0)
        {
            return await _db.Customers
                .AsNoTracking()
                .OrderByDescending(c => c.UpdatedAt)
                .ThenBy(c => c.Phone1)
                .Take(500)
                .ToListAsync(cancellationToken);
        }

        var digits = PhoneNumberNormalizer.DigitsOnly(q);

        return await _db.Customers
            .AsNoTracking()
            .Where(c =>
                (digits.Length >= 2 &&
                 (c.Phone1.Contains(digits) || (c.Phone2 != null && c.Phone2.Contains(digits)))) ||
                (c.FullName != null && c.FullName.Contains(q)))
            .OrderByDescending(c => c.UpdatedAt)
            .ThenBy(c => c.Phone1)
            .Take(200)
            .ToListAsync(cancellationToken);
    }

    public async Task UpsertAsync(Customer customer, CancellationToken cancellationToken = default)
    {
        var tracked = await _db.Customers
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

            var existing = await _db.Customers
                .FirstOrDefaultAsync(c => c.Phone1 == oldPhone1, cancellationToken)
                ?? throw new InvalidOperationException($"Customer {oldPhone1} was not found for phone change.");

            _db.Customers.Remove(existing);
            await _db.Customers.AddAsync(updated, cancellationToken);
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
}
