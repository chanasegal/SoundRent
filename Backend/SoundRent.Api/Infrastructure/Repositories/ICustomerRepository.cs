using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Infrastructure.Repositories;

public interface ICustomerRepository
{
    Task<Customer?> GetByPhone1Async(string phone1Digits, CancellationToken cancellationToken = default);

    Task<Customer?> GetTrackedByPhone1Async(string phone1Digits, CancellationToken cancellationToken = default);

    Task<List<Customer>> GetAllAsync(
        SystemType? systemType = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Search customers. When <paramref name="systemType"/> is set, only linked profiles are returned.
    /// When null, searches the entire unified directory (cross-context autocomplete).
    /// </summary>
    Task<List<Customer>> SearchAsync(
        string? query,
        SystemType? systemType = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Lean autocomplete: phones-only or name-only (no OR across field groups),
    /// no Systems include, capped at 10 rows.
    /// </summary>
    Task<List<CustomerSuggestRow>> SearchSuggestAsync(
        string? query,
        SystemType? systemType = null,
        CancellationToken cancellationToken = default);

    Task UpsertAsync(Customer customer, CancellationToken cancellationToken = default);

    Task UpdateFieldsAsync(Customer customer, CancellationToken cancellationToken = default);

    Task EnsureSystemLinkAsync(
        string phone1Digits,
        SystemType systemType,
        CancellationToken cancellationToken = default);

    /// <summary>Re-keys the customer and cascades the new primary phone to orders, waitlist, and system links.</summary>
    Task ReplacePhone1WithCascadeAsync(
        string oldPhone1,
        Customer updated,
        CancellationToken cancellationToken = default);

    void Remove(Customer customer);

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
