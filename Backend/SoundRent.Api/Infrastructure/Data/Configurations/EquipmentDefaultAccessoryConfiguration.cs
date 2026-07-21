using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class EquipmentDefaultAccessoryConfiguration : IEntityTypeConfiguration<EquipmentDefaultAccessory>
{
    public void Configure(EntityTypeBuilder<EquipmentDefaultAccessory> builder)
    {
        builder.ToTable("EquipmentDefaultAccessories");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.ParentEquipmentType)
            .IsRequired();

        builder.Property(e => e.ParentSerialCode)
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(e => e.AccessoryEquipmentType)
            .IsRequired();

        builder.Property(e => e.AccessorySerialCode)
            .HasMaxLength(100)
            .IsRequired();

        builder.HasIndex(e => new
            {
                e.ParentEquipmentType,
                e.ParentSerialCode,
                e.AccessoryEquipmentType,
                e.AccessorySerialCode
            })
            .IsUnique()
            .HasDatabaseName("IX_EquipmentDefaultAccessories_ParentUnit_Type_Code");

        builder.HasIndex(e => new { e.ParentEquipmentType, e.ParentSerialCode })
            .HasDatabaseName("IX_EquipmentDefaultAccessories_ParentUnit");
    }
}
