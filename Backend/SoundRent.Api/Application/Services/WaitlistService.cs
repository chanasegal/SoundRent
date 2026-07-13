using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Application.Services;

public class WaitlistService : IWaitlistService
{
    private readonly IWaitlistRepository _repository;
    private readonly ICustomerService _customerService;

    public WaitlistService(IWaitlistRepository repository, ICustomerService customerService)
    {
        _repository = repository;
        _customerService = customerService;
    }

    public async Task<List<WaitlistEntryDto>> GetWeeklyAsync(
        DateOnly startDate,
        DateOnly endDate,
        SystemType? systemType = null,
        CancellationToken cancellationToken = default)
    {
        if (endDate < startDate)
        {
            throw new ValidationException("תאריך הסיום חייב להיות באותו יום או אחרי תאריך ההתחלה");
        }

        var list = await _repository.GetByDateRangeAsync(startDate, endDate, systemType, cancellationToken);
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
            Notes = string.IsNullOrWhiteSpace(dto.Notes) ? null : dto.Notes.Trim(),
            SystemType = dto.SystemType
        };

        await _repository.AddAsync(entity, cancellationToken);
        await _repository.SaveChangesAsync(cancellationToken);
        await _customerService.SyncFromWaitlistAsync(
            dto.Phone,
            dto.CustomerName,
            dto.Address,
            dto.SystemType,
            cancellationToken);

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
        CreatedAt = e.CreatedAt,
        SystemType = e.SystemType
    };
}
