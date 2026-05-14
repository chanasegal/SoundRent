using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Infrastructure.Repositories;

public class LoanedEquipmentTypeNoteDefaultRepository : ILoanedEquipmentTypeNoteDefaultRepository
{
    private readonly AppDbContext _db;

    public LoanedEquipmentTypeNoteDefaultRepository(AppDbContext db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<LoanedEquipmentTypeNoteDefault>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        return await _db.LoanedEquipmentTypeNoteDefaults
            .AsNoTracking()
            .OrderBy(r => r.LoanedEquipmentType)
            .ToListAsync(cancellationToken);
    }

    public Task<LoanedEquipmentTypeNoteDefault?> GetAsync(LoanedEquipmentType type, CancellationToken cancellationToken = default)
    {
        return _db.LoanedEquipmentTypeNoteDefaults.FirstOrDefaultAsync(r => r.LoanedEquipmentType == type, cancellationToken);
    }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        return _db.SaveChangesAsync(cancellationToken);
    }
}
