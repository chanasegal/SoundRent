using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Repositories;

public interface ICustomerRepository
{
    Task<Customer?> GetByPhone1Async(string phone1Digits, CancellationToken cancellationToken = default);

    Task<List<Customer>> SearchAsync(string? query, CancellationToken cancellationToken = default);

    Task UpsertAsync(Customer customer, CancellationToken cancellationToken = default);

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
