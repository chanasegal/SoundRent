using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Repositories;

public interface ICustomerRepository
{
    Task<Customer?> GetByPhone1Async(string phone1Digits, CancellationToken cancellationToken = default);

    Task<Customer?> GetTrackedByPhone1Async(string phone1Digits, CancellationToken cancellationToken = default);

    Task<List<Customer>> GetAllAsync(CancellationToken cancellationToken = default);

    Task<List<Customer>> SearchAsync(string? query, CancellationToken cancellationToken = default);

    Task UpsertAsync(Customer customer, CancellationToken cancellationToken = default);

    void Remove(Customer customer);

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
