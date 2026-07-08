using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Application.Services;

public class LostEquipmentService : ILostEquipmentService
{
    private readonly ILostEquipmentRepository _repository;

    public LostEquipmentService(ILostEquipmentRepository repository)
    {
        _repository = repository;
    }

    public async Task<List<LostEquipmentDto>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        var rows = await _repository.GetAllOrderedAsync(cancellationToken);
        return rows.Select(ToDto).ToList();
    }

    public async Task<LostEquipmentDto> CreateAsync(LostEquipmentCreateDto dto, CancellationToken cancellationToken = default)
    {
        var now = DateTime.UtcNow;
        var entity = new LostEquipment
        {
            CustomerName = dto.CustomerName.Trim(),
            Phone = NullIfBlank(dto.Phone),
            ItemDescription = dto.ItemDescription.Trim(),
            HebrewDate = dto.HebrewDate.Trim(),
            Notes = NullIfBlank(dto.Notes),
            Status = LostEquipmentStatus.Pending,
            CreatedAt = now,
            UpdatedAt = now
        };

        await _repository.AddAsync(entity, cancellationToken);
        await _repository.SaveChangesAsync(cancellationToken);

        return ToDto(entity);
    }

    public async Task<LostEquipmentDto> UpdateAsync(int id, LostEquipmentUpdateDto dto, CancellationToken cancellationToken = default)
    {
        var entity = await _repository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("רשומת הציוד לא נמצאה");

        if (!Enum.IsDefined(dto.Status))
        {
            throw new ValidationException("סטטוס לא תקין");
        }

        entity.CustomerName = dto.CustomerName.Trim();
        entity.Phone = NullIfBlank(dto.Phone);
        entity.ItemDescription = dto.ItemDescription.Trim();
        entity.HebrewDate = dto.HebrewDate.Trim();
        entity.Notes = NullIfBlank(dto.Notes);
        entity.Status = dto.Status;
        entity.UpdatedAt = DateTime.UtcNow;

        await _repository.SaveChangesAsync(cancellationToken);

        return ToDto(entity);
    }

    public async Task DeleteAsync(int id, CancellationToken cancellationToken = default)
    {
        var entity = await _repository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("רשומת הציוד לא נמצאה");

        _repository.Remove(entity);
        await _repository.SaveChangesAsync(cancellationToken);
    }

    private static LostEquipmentDto ToDto(LostEquipment e) => new()
    {
        Id = e.Id,
        CustomerName = e.CustomerName,
        Phone = e.Phone,
        ItemDescription = e.ItemDescription,
        HebrewDate = e.HebrewDate,
        Notes = e.Notes,
        Status = e.Status,
        CreatedAt = e.CreatedAt,
        UpdatedAt = e.UpdatedAt
    };

    private static string? NullIfBlank(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }
}
