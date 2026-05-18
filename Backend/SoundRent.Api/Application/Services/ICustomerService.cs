using SoundRent.Api.Application.DTOs;

namespace SoundRent.Api.Application.Services;

public interface ICustomerService
{
    const string ExcelContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    Task<List<CustomerDto>> SearchAsync(string? query, CancellationToken cancellationToken = default);

    Task<(byte[] Content, string FileName)> ExportToExcelAsync(CancellationToken cancellationToken = default);

    Task<CustomerDto> UpsertAsync(CustomerUpsertDto dto, CancellationToken cancellationToken = default);

    Task<List<OrderDto>> GetOrdersByPhone1Async(string phoneFromRoute, CancellationToken cancellationToken = default);

    Task DeleteAsync(string phoneFromRoute, CancellationToken cancellationToken = default);

    Task SyncFromOrderAsync(OrderCreateUpdateDto dto, CancellationToken cancellationToken = default);
}
