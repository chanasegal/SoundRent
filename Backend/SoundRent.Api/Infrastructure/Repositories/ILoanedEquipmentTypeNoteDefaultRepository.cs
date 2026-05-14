using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Infrastructure.Repositories;

public interface ILoanedEquipmentTypeNoteDefaultRepository
{
    Task<IReadOnlyList<LoanedEquipmentTypeNoteDefault>> GetAllAsync(CancellationToken cancellationToken = default);

    Task<LoanedEquipmentTypeNoteDefault?> GetAsync(LoanedEquipmentType type, CancellationToken cancellationToken = default);

    Task<int> SaveChangesAsync(CancellationToken cancellationToken = default);
}
