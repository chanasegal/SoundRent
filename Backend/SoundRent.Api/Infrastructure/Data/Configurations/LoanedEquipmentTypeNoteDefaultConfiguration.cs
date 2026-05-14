using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class LoanedEquipmentTypeNoteDefaultConfiguration : IEntityTypeConfiguration<LoanedEquipmentTypeNoteDefault>
{
    public void Configure(EntityTypeBuilder<LoanedEquipmentTypeNoteDefault> builder)
    {
        builder.ToTable("LoanedEquipmentTypeNoteDefaults");

        builder.HasKey(x => x.LoanedEquipmentType);

        builder.Property(x => x.DefaultNoteCount)
            .IsRequired();
    }
}
