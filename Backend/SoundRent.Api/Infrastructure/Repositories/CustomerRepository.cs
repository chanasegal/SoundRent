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

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return _db.SaveChangesAsync(cancellationToken);
    }
}
