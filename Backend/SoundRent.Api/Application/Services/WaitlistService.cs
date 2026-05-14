using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Application.Services;

public class WaitlistService : IWaitlistService
{
    private readonly IWaitlistRepository _repository;

    public WaitlistService(IWaitlistRepository repository)
    {
        _repository = repository;
    }

    public async Task<List<WaitlistEntryDto>> GetWeeklyAsync(DateOnly startDate, CancellationToken cancellationToken = default)
    {
        var endDate = startDate.AddDays(6);
        var list = await _repository.GetByDateRangeAsync(startDate, endDate, cancellationToken);
        return list.Select(ToDto).ToList();
    }

    public async Task<List<WaitlistEntryDto>> GetAllForExportAsync(CancellationToken cancellationToken = default)
    {
        var list = await _repository.GetAllOrderedForExportAsync(cancellationToken);
        return list.Select(ToDto).ToList();
    }

    public async Task<WaitlistEntryDto> CreateAsync(WaitlistEntryCreateDto dto, CancellationToken cancellationToken = default)
    {
        var entity = new WaitlistEntry
        {
            CustomerName = string.IsNullOrWhiteSpace(dto.CustomerName) ? null : dto.CustomerName.Trim(),
            Phone = dto.Phone.Trim(),
            EquipmentType = dto.EquipmentType,
            WaitlistDate = dto.Date,
            Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim()
        };

        await _repository.AddAsync(entity, cancellationToken);
        await _repository.SaveChangesAsync(cancellationToken);

        return ToDto(entity);
    }

    public async Task DeleteAsync(int id, CancellationToken cancellationToken = default)
    {
        var entity = await _repository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("רשומת ההמתנה לא נמצאה");

        _repository.Remove(entity);
        await _repository.SaveChangesAsync(cancellationToken);
    }

    private static WaitlistEntryDto ToDto(WaitlistEntry e) => new()
    {
        Id = e.Id,
        CustomerName = e.CustomerName,
        Phone = e.Phone,
        EquipmentType = e.EquipmentType,
        Date = e.WaitlistDate,
        Notes = e.Notes,
        CreatedAt = e.CreatedAt
    };
}
