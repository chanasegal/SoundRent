using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Mapping;
using SoundRent.Api.Application.PhoneNumbers;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Application.Services;

public class CustomerService : ICustomerService
{
    private readonly ICustomerRepository _customers;
    private readonly IOrderRepository _orders;

    public CustomerService(ICustomerRepository customers, IOrderRepository orders)
    {
        _customers = customers;
        _orders = orders;
    }

    public async Task<List<CustomerDto>> SearchAsync(string? query, CancellationToken cancellationToken = default)
    {
        var rows = await _customers.SearchAsync(query, cancellationToken);
        return rows.Select(ToDto).ToList();
    }

    public async Task<CustomerDto> UpsertAsync(CustomerUpsertDto dto, CancellationToken cancellationToken = default)
    {
        var p1 = PhoneNumberNormalizer.DigitsOnly(dto.Phone1);
        if (!PhoneNumberNormalizer.IsValidStoredPhone(p1))
        {
            throw new ValidationException("מספר טלפון ראשי לא תקין");
        }

        var p2 = string.IsNullOrWhiteSpace(dto.Phone2) ? null : PhoneNumberNormalizer.DigitsOnly(dto.Phone2);
        if (!string.IsNullOrEmpty(p2) && !PhoneNumberNormalizer.IsValidStoredPhone(p2))
        {
            throw new ValidationException("מספר טלפון משני לא תקין");
        }

        if (p2 == p1)
        {
            throw new ValidationException("לא ניתן לשכפל את אותו מספר בשתי השדות");
        }

        var entity = new Customer
        {
            Phone1 = p1,
            Phone2 = p2,
            FullName = NullIfWhiteSpace(dto.FullName),
            Address = NullIfWhiteSpace(dto.Address),
            Notes = NullIfWhiteSpace(dto.Notes),
            UpdatedAt = DateTime.UtcNow
        };

        await _customers.UpsertAsync(entity, cancellationToken);
        await _customers.SaveChangesAsync(cancellationToken);

        var saved = await _customers.GetByPhone1Async(p1, cancellationToken);
        return ToDto(saved!);
    }

    public async Task<List<OrderDto>> GetOrdersByPhone1Async(string phoneFromRoute, CancellationToken cancellationToken = default)
    {
        var raw = Uri.UnescapeDataString(phoneFromRoute ?? string.Empty);
        var p1 = PhoneNumberNormalizer.DigitsOnly(raw);
        if (!PhoneNumberNormalizer.IsValidStoredPhone(p1))
        {
            throw new ValidationException("מספר טלפון לא תקין");
        }

        var customer = await _customers.GetByPhone1Async(p1, cancellationToken)
            ?? throw new NotFoundException("הלקוח לא נמצא");

        var phones = new List<string> { customer.Phone1 };
        if (!string.IsNullOrEmpty(customer.Phone2))
        {
            phones.Add(customer.Phone2);
        }

        var orders = await _orders.GetOrdersForCustomerPhonesAsync(phones, cancellationToken);
        return orders.Select(OrderMapper.ToDto).ToList();
    }

    public async Task SyncFromOrderAsync(OrderCreateUpdateDto dto, CancellationToken cancellationToken = default)
    {
        var p1 = PhoneNumberNormalizer.DigitsOnly(dto.Phone);
        if (!PhoneNumberNormalizer.IsValidStoredPhone(p1))
        {
            return;
        }

        var p2Raw = PhoneNumberNormalizer.DigitsOnly(dto.Phone2);
        var p2 = string.IsNullOrEmpty(p2Raw) ? null : (PhoneNumberNormalizer.IsValidStoredPhone(p2Raw) ? p2Raw : null);
        if (p2 == p1)
        {
            p2 = null;
        }

        var existing = await _customers.GetByPhone1Async(p1, cancellationToken);
        var entity = new Customer
        {
            Phone1 = p1,
            Phone2 = p2,
            FullName = NullIfWhiteSpace(dto.CustomerName),
            Address = NullIfWhiteSpace(dto.Address),
            Notes = existing?.Notes,
            UpdatedAt = DateTime.UtcNow
        };

        await _customers.UpsertAsync(entity, cancellationToken);
        await _customers.SaveChangesAsync(cancellationToken);
    }

    private static CustomerDto ToDto(Customer c) => new()
    {
        Phone1 = c.Phone1,
        Phone2 = c.Phone2,
        FullName = c.FullName,
        Address = c.Address,
        Notes = c.Notes,
        UpdatedAt = c.UpdatedAt
    };

    private static string? NullIfWhiteSpace(string? s)
    {
        if (string.IsNullOrWhiteSpace(s))
        {
            return null;
        }

        var t = s.Trim();
        return t.Length == 0 ? null : t;
    }
}
