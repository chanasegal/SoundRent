using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Exceptions;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Application.Services;

public class BlockedDateService : IBlockedDateService
{
    private readonly IBlockedDateRepository _repository;

    public BlockedDateService(IBlockedDateRepository repository)
    {
        _repository = repository;
    }

    public async Task<List<BlockedDateDto>> GetAllAsync(
        SystemType? systemType = null,
        CancellationToken cancellationToken = default)
    {
        var rows = await _repository.GetAllOrderedAsync(systemType, cancellationToken);
        return rows.Select(ToDto).ToList();
    }

    public async Task<List<BlockedDateDto>> GetOverlappingAsync(
        DateOnly? rangeStart,
        DateOnly? rangeEnd,
        SystemType? systemType = null,
        CancellationToken cancellationToken = default)
    {
        if (rangeStart is null || rangeEnd is null)
        {
            return await GetAllAsync(systemType, cancellationToken);
        }

        if (rangeEnd.Value < rangeStart.Value)
        {
            throw new ValidationException("תאריך הסיום חייב להיות באותו יום או אחרי תאריך ההתחלה");
        }

        var rows = await _repository.GetOverlappingAsync(
            rangeStart.Value,
            rangeEnd.Value,
            systemType,
            cancellationToken);
        return rows.Select(ToDto).ToList();
    }

    public async Task<BlockedDateDto> CreateAsync(BlockedDateCreateDto dto, CancellationToken cancellationToken = default)
    {
        ValidateRange(dto.StartDate, dto.EndDate);

        var now = DateTime.UtcNow;
        var entity = new BlockedDate
        {
            StartDate = dto.StartDate,
            EndDate = dto.EndDate,
            Reason = NullIfBlank(dto.Reason),
            SystemType = dto.SystemType,
            CreatedAt = now,
            UpdatedAt = now
        };

        await _repository.AddAsync(entity, cancellationToken);
        await _repository.SaveChangesAsync(cancellationToken);

        return ToDto(entity);
    }

    public async Task<BlockedDateDto> UpdateAsync(int id, BlockedDateUpdateDto dto, CancellationToken cancellationToken = default)
    {
        ValidateRange(dto.StartDate, dto.EndDate);

        var entity = await _repository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("חסימת התאריך לא נמצאה");

        entity.StartDate = dto.StartDate;
        entity.EndDate = dto.EndDate;
        entity.Reason = NullIfBlank(dto.Reason);
        entity.UpdatedAt = DateTime.UtcNow;

        await _repository.SaveChangesAsync(cancellationToken);

        return ToDto(entity);
    }

    public async Task DeleteAsync(int id, CancellationToken cancellationToken = default)
    {
        var entity = await _repository.GetByIdAsync(id, cancellationToken)
            ?? throw new NotFoundException("חסימת התאריך לא נמצאה");

        _repository.Remove(entity);
        await _repository.SaveChangesAsync(cancellationToken);
    }

    private static void ValidateRange(DateOnly start, DateOnly end)
    {
        if (end < start)
        {
            throw new ValidationException("תאריך הסיום חייב להיות באותו יום או אחרי תאריך ההתחלה");
        }
    }

    private static BlockedDateDto ToDto(BlockedDate b) => new()
    {
        Id = b.Id,
        StartDate = b.StartDate,
        EndDate = b.EndDate,
        Reason = b.Reason,
        CreatedAt = b.CreatedAt,
        UpdatedAt = b.UpdatedAt,
        SystemType = b.SystemType
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
