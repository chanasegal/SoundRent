using ClosedXML.Excel;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Mapping;
using SoundRent.Api.Application.Validation;
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

    public async Task<(byte[] Content, string FileName)> ExportToExcelAsync(CancellationToken cancellationToken = default)
    {
        var customers = await _customers.GetAllAsync(cancellationToken);

        using var workbook = new XLWorkbook();
        var worksheet = workbook.Worksheets.Add("לקוחות");
        worksheet.RightToLeft = true;

        string[] headers = ["שם", "טלפון 1", "טלפון 2", "כתובת"];
        for (var col = 0; col < headers.Length; col++)
        {
            worksheet.Cell(1, col + 1).Value = headers[col];
        }

        for (var row = 0; row < customers.Count; row++)
        {
            var customer = customers[row];
            var excelRow = row + 2;
            worksheet.Cell(excelRow, 1).Value = customer.FullName ?? string.Empty;
            worksheet.Cell(excelRow, 2).Value = customer.Phone1;
            worksheet.Cell(excelRow, 3).Value = customer.Phone2 ?? string.Empty;
            worksheet.Cell(excelRow, 4).Value = customer.Address ?? string.Empty;
        }

        var usedRange = worksheet.Range(1, 1, Math.Max(customers.Count + 1, 1), headers.Length);
        usedRange.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
        usedRange.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;

        var headerRange = worksheet.Range(1, 1, 1, headers.Length);
        headerRange.Style.Font.Bold = true;
        headerRange.Style.Fill.BackgroundColor = XLColor.FromHtml("#E0F2FE");
        headerRange.Style.Border.BottomBorder = XLBorderStyleValues.Thin;

        worksheet.Columns().AdjustToContents();

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);

        var date = IsraelDateHelper.TodayInIsrael().ToString("yyyyMMdd");
        return (stream.ToArray(), $"customers_backup_{date}.xlsx");
    }

    public async Task<CustomerDto> UpsertAsync(CustomerUpsertDto dto, CancellationToken cancellationToken = default)
    {
        if (!IsraeliPhoneValidator.TryNormalizeRequired(dto.Phone1, out var p1))
        {
            throw new ValidationException(IsraeliPhoneValidator.InvalidPhoneMessage);
        }

        if (!IsraeliPhoneValidator.TryNormalizeOptional(dto.Phone2, out var p2))
        {
            throw new ValidationException(IsraeliPhoneValidator.InvalidPhoneMessage);
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

    public async Task<CustomerDto> UpdateAsync(
        string originalPhoneFromRoute,
        CustomerUpsertDto dto,
        CancellationToken cancellationToken = default)
    {
        var originalP1 = NormalizeRoutePhone(originalPhoneFromRoute);

        if (!IsraeliPhoneValidator.TryNormalizeRequired(dto.Phone1, out var newP1))
        {
            throw new ValidationException(IsraeliPhoneValidator.InvalidPhoneMessage);
        }

        if (!IsraeliPhoneValidator.TryNormalizeOptional(dto.Phone2, out var p2))
        {
            throw new ValidationException(IsraeliPhoneValidator.InvalidPhoneMessage);
        }

        if (p2 == newP1)
        {
            throw new ValidationException("לא ניתן לשכפל את אותו מספר בשתי השדות");
        }

        _ = await _customers.GetTrackedByPhone1Async(originalP1, cancellationToken)
            ?? throw new NotFoundException("הלקוח לא נמצא");

        var entity = new Customer
        {
            Phone1 = newP1,
            Phone2 = p2,
            FullName = NullIfWhiteSpace(dto.FullName),
            Address = NullIfWhiteSpace(dto.Address),
            Notes = NullIfWhiteSpace(dto.Notes),
            UpdatedAt = DateTime.UtcNow
        };

        if (!string.Equals(newP1, originalP1, StringComparison.Ordinal))
        {
            var taken = await _customers.GetByPhone1Async(newP1, cancellationToken);
            if (taken is not null)
            {
                throw new ValidationException(IsraeliPhoneValidator.Phone1AlreadyTakenMessage);
            }

            await _customers.ReplacePhone1WithCascadeAsync(originalP1, entity, cancellationToken);
        }
        else
        {
            await _customers.UpdateFieldsAsync(entity, cancellationToken);
            await _customers.SaveChangesAsync(cancellationToken);
        }

        var saved = await _customers.GetByPhone1Async(newP1, cancellationToken);
        return ToDto(saved!);
    }

    public async Task<List<OrderDto>> GetOrdersByPhone1Async(string phoneFromRoute, CancellationToken cancellationToken = default)
    {
        var raw = Uri.UnescapeDataString(phoneFromRoute ?? string.Empty);
        var p1 = PhoneNumberNormalizer.DigitsOnly(raw);
        if (!PhoneNumberNormalizer.IsValidStoredPhone(p1))
        {
            throw new ValidationException(IsraeliPhoneValidator.InvalidPhoneMessage);
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

    public async Task DeleteAsync(string phoneFromRoute, CancellationToken cancellationToken = default)
    {
        var originalP1 = NormalizeRoutePhone(phoneFromRoute);

        var customer = await _customers.GetTrackedByPhone1Async(originalP1, cancellationToken)
            ?? throw new NotFoundException("הלקוח לא נמצא");

        var phones = new List<string> { customer.Phone1 };
        if (!string.IsNullOrEmpty(customer.Phone2))
        {
            phones.Add(customer.Phone2);
        }

        var hasActiveOrders = await _orders.HasActiveOrFutureOrdersForCustomerPhonesAsync(
            phones,
            IsraelDateHelper.TodayInIsrael(),
            cancellationToken);
        if (hasActiveOrders)
        {
            throw new ValidationException("לא ניתן למחוק לקוח שיש לו הזמנות פעילות במערכת");
        }

        _customers.Remove(customer);
        await _customers.SaveChangesAsync(cancellationToken);
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

    private static string NormalizeRoutePhone(string phoneFromRoute)
    {
        var raw = Uri.UnescapeDataString(phoneFromRoute ?? string.Empty);
        var p1 = PhoneNumberNormalizer.DigitsOnly(raw);
        if (!PhoneNumberNormalizer.IsValidStoredPhone(p1))
        {
            throw new ValidationException(IsraeliPhoneValidator.InvalidPhoneMessage);
        }

        return p1;
    }
}
