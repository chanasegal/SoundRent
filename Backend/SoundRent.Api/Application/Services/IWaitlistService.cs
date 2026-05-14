using SoundRent.Api.Application.DTOs;

namespace SoundRent.Api.Application.Services;

public interface IWaitlistService
{
    Task<List<WaitlistEntryDto>> GetWeeklyAsync(DateOnly startDate, CancellationToken cancellationToken = default);

    /// <summary>Every waitlist entry for Excel backup (sorted by requested date, then date added).</summary>
    Task<List<WaitlistEntryDto>> GetAllForExportAsync(CancellationToken cancellationToken = default);

    Task<WaitlistEntryDto> CreateAsync(WaitlistEntryCreateDto dto, CancellationToken cancellationToken = default);

    Task DeleteAsync(int id, CancellationToken cancellationToken = default);
}
