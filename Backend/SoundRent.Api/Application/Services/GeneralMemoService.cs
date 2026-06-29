using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Application.Services;

public class GeneralMemoService : IGeneralMemoService
{
    private readonly AppDbContext _db;

    public GeneralMemoService(AppDbContext db)
    {
        _db = db;
    }

    public async Task<GeneralMemoDto> GetAsync(CancellationToken cancellationToken = default)
    {
        var memo = await EnsureMemoRowAsync(cancellationToken);
        return ToDto(memo);
    }

    public async Task<GeneralMemoDto> SaveAsync(string? content, CancellationToken cancellationToken = default)
    {
        var memo = await EnsureMemoRowAsync(cancellationToken);
        memo.Content = content ?? string.Empty;
        memo.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(cancellationToken);
        return ToDto(memo);
    }

    private async Task<GeneralMemo> EnsureMemoRowAsync(CancellationToken cancellationToken)
    {
        var memo = await _db.GeneralMemos
            .FirstOrDefaultAsync(m => m.Id == GeneralMemo.SingletonId, cancellationToken);

        if (memo is not null)
        {
            return memo;
        }

        memo = new GeneralMemo
        {
            Id = GeneralMemo.SingletonId,
            Content = string.Empty,
            UpdatedAt = DateTime.UtcNow
        };
        _db.GeneralMemos.Add(memo);
        await _db.SaveChangesAsync(cancellationToken);
        return memo;
    }

    private static GeneralMemoDto ToDto(GeneralMemo memo) => new()
    {
        Content = memo.Content,
        UpdatedAt = memo.UpdatedAt
    };
}
