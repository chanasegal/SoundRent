using SoundRent.Api.Application.DTOs;

namespace SoundRent.Api.Application.Services;

public interface IInstitutionService
{
    const string ExcelContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    Task<List<InstitutionDto>> SearchAsync(string? query, CancellationToken cancellationToken = default);

    Task<InstitutionDto?> GetByIdAsync(int id, CancellationToken cancellationToken = default);

    Task<InstitutionDto> CreateAsync(InstitutionCreateUpdateDto dto, CancellationToken cancellationToken = default);

    Task<InstitutionDto> UpdateAsync(int id, InstitutionCreateUpdateDto dto, CancellationToken cancellationToken = default);

    Task DeleteAsync(int id, CancellationToken cancellationToken = default);

    Task<(byte[] Content, string FileName)> ExportToExcelAsync(CancellationToken cancellationToken = default);

    Task<List<OrderDto>> GetOrdersAsync(int institutionId, CancellationToken cancellationToken = default);
}
