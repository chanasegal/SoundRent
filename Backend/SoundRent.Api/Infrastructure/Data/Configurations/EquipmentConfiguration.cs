using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class EquipmentConfiguration : IEntityTypeConfiguration<Equipment>
{
    public void Configure(EntityTypeBuilder<Equipment> builder)
    {
        builder.ToTable("Equipments");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.EquipmentType)
            .IsRequired();

        builder.Property(e => e.IsMaintenanceMode)
            .IsRequired()
            .HasDefaultValue(false);

        builder.HasIndex(e => e.EquipmentType)
            .IsUnique()
            .HasDatabaseName("IX_Equipments_EquipmentType_Unique");
    }
}
