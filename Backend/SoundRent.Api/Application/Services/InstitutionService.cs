using ClosedXML.Excel;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Application.Mapping;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Application.Services;

public class InstitutionService : IInstitutionService
{
    private readonly IInstitutionRepository _institutions;
    private readonly IOrderRepository _orders;

    public InstitutionService(IInstitutionRepository institutions, IOrderRepository orders)
    {
        _institutions = institutions;
        _orders = orders;
    }

    public async Task<List<InstitutionDto>> SearchAsync(string? query, CancellationToken cancellationToken = default)
    {
        var rows = await _institutions.SearchAsync(query, cancellationToken);
        return rows.Select(ToDto).ToList();
    }

    public async Task<InstitutionDto?> GetByIdAsync(int id, CancellationToken cancellationToken = default)
    {
        var entity = await _institutions.GetByIdAsync(id, cancellationToken);
        return entity is null ? null : ToDto(entity);
    }

    public async Task<InstitutionDto> CreateAsync(
        InstitutionCreateUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        var name = RequireName(dto.Name);
        var existing = await _institutions.FindByNameAsync(name, cancellationToken);
        if (existing is not null)
        {
            throw new ValidationException("מוסד עם שם זה כבר קיים במערכת");
        }

        var entity = new Institution
        {
            Name = name,
            DefaultNote = NullIfWhiteSpace(dto.DefaultNote)
        };

        await _institutions.AddAsync(entity, cancellationToken);
        await _institutions.SaveChangesAsync(cancellationToken);
        return ToDto(entity);
    }

    public async Task<InstitutionDto> UpdateAsync(
        int id,
        InstitutionCreateUpdateDto dto,
        CancellationToken cancellationToken = default)
    {
        var entity = await _institutions.GetByIdTrackedAsync(id, cancellationToken)
            ?? throw new NotFoundException("המוסד לא נמצא");

        var name = RequireName(dto.Name);
        var duplicate = await _institutions.FindByNameAsync(name, cancellationToken);
        if (duplicate is not null && duplicate.Id != id)
        {
            throw new ValidationException("מוסד עם שם זה כבר קיים במערכת");
        }

        entity.Name = name;
        entity.DefaultNote = NullIfWhiteSpace(dto.DefaultNote);

        // Keep denormalized name on orders in sync for display/legacy conflict probes.
        await _orders.SyncInstitutionNameAsync(id, name, cancellationToken);

        await _institutions.SaveChangesAsync(cancellationToken);
        return ToDto(entity);
    }

    public async Task DeleteAsync(int id, CancellationToken cancellationToken = default)
    {
        var entity = await _institutions.GetByIdTrackedAsync(id, cancellationToken)
            ?? throw new NotFoundException("המוסד לא נמצא");

        var hasActive = await _institutions.HasActiveOrFutureOrdersAsync(
            id,
            IsraelDateHelper.TodayInIsrael(),
            cancellationToken);
        if (hasActive)
        {
            throw new ValidationException("לא ניתן למחוק מוסד שיש לו הזמנות פעילות במערכת");
        }

        _institutions.Remove(entity);
        await _institutions.SaveChangesAsync(cancellationToken);
    }

    public async Task<(byte[] Content, string FileName)> ExportToExcelAsync(
        CancellationToken cancellationToken = default)
    {
        var institutions = await _institutions.GetAllAsync(cancellationToken);

        using var workbook = new XLWorkbook();
        var worksheet = workbook.Worksheets.Add("מוסדות");

        string[] headers = ["שם מוסד", "הערה ברירת מחדל"];
        for (var col = 0; col < headers.Length; col++)
        {
            worksheet.Cell(1, col + 1).Value = headers[col];
        }

        for (var row = 0; row < institutions.Count; row++)
        {
            var institution = institutions[row];
            var excelRow = row + 2;
            worksheet.Cell(excelRow, 1).Value = institution.Name;
            worksheet.Cell(excelRow, 2).Value = institution.DefaultNote ?? string.Empty;
        }

        ExcelExportFormatting.ApplyStandardLayout(
            worksheet,
            headerRow: 1,
            columnCount: headers.Length,
            lastDataRow: Math.Max(institutions.Count + 1, 1));

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);

        var date = IsraelDateHelper.TodayInIsrael().ToString("yyyyMMdd");
        return (stream.ToArray(), $"institutions_backup_{date}.xlsx");
    }

    public async Task<List<OrderDto>> GetOrdersAsync(int institutionId, CancellationToken cancellationToken = default)
    {
        _ = await _institutions.GetByIdAsync(institutionId, cancellationToken)
            ?? throw new NotFoundException("המוסד לא נמצא");

        var orders = await _orders.GetOrdersForInstitutionAsync(institutionId, cancellationToken);
        return orders.Select(OrderMapper.ToDto).ToList();
    }

    private static InstitutionDto ToDto(Institution i) => new()
    {
        Id = i.Id,
        Name = i.Name,
        DefaultNote = i.DefaultNote
    };

    private static string RequireName(string? name)
    {
        var trimmed = NullIfWhiteSpace(name);
        if (trimmed is null)
        {
            throw new ValidationException("יש להזין שם מוסד");
        }

        return trimmed;
    }

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
