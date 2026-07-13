using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.Services;

public interface ICustomerService
{
    const string ExcelContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    Task<List<CustomerDto>> SearchAsync(
        string? query,
        SystemType? systemType = null,
        CancellationToken cancellationToken = default);

    Task<(byte[] Content, string FileName)> ExportToExcelAsync(
        SystemType? systemType = null,
        CancellationToken cancellationToken = default);

    Task<CustomerDto> UpsertAsync(CustomerUpsertDto dto, CancellationToken cancellationToken = default);

    Task<CustomerDto> UpdateAsync(
        string originalPhoneFromRoute,
        CustomerUpsertDto dto,
        CancellationToken cancellationToken = default);

    Task<List<OrderDto>> GetOrdersByPhone1Async(string phoneFromRoute, CancellationToken cancellationToken = default);

    Task DeleteAsync(string phoneFromRoute, CancellationToken cancellationToken = default);

    Task SyncFromOrderAsync(OrderCreateUpdateDto dto, CancellationToken cancellationToken = default);

    Task SyncFromWaitlistAsync(
        string phone,
        string? customerName,
        string? address,
        SystemType systemType,
        CancellationToken cancellationToken = default);
}
