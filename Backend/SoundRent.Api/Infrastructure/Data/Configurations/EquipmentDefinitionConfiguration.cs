using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class EquipmentDefinitionConfiguration : IEntityTypeConfiguration<EquipmentDefinition>
{
    public void Configure(EntityTypeBuilder<EquipmentDefinition> builder)
    {
        builder.ToTable("EquipmentDefinitions");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.Id).HasMaxLength(64);
        builder.Property(e => e.DisplayName).HasMaxLength(200).IsRequired();
        builder.Property(e => e.Category).HasMaxLength(80).IsRequired();

        builder.HasIndex(e => e.SortOrder)
            .HasDatabaseName("IX_EquipmentDefinitions_SortOrder");

        builder.Property(e => e.IsMaintenanceMode)
            .HasDefaultValue(false);
    }
}
