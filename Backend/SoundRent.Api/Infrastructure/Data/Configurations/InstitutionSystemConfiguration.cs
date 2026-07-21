using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class InstitutionSystemConfiguration : IEntityTypeConfiguration<InstitutionSystem>
{
    public void Configure(EntityTypeBuilder<InstitutionSystem> builder)
    {
        builder.ToTable("InstitutionSystems");

        builder.HasKey(s => new { s.InstitutionId, s.SystemType });

        builder.Property(s => s.SystemType)
            .IsRequired();

        builder.Property(s => s.LinkedAt)
            .HasDefaultValueSql("CURRENT_TIMESTAMP");

        builder.HasIndex(s => s.SystemType)
            .HasDatabaseName("IX_InstitutionSystems_SystemType");

        builder.HasOne(s => s.Institution)
            .WithMany(i => i.Systems)
            .HasForeignKey(s => s.InstitutionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
