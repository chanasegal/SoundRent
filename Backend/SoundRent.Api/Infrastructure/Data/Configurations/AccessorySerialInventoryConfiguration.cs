using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class AccessorySerialInventoryConfiguration : IEntityTypeConfiguration<AccessorySerialInventory>
{
    public void Configure(EntityTypeBuilder<AccessorySerialInventory> builder)
    {
        builder.ToTable("AccessorySerialInventory");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.SerialCode)
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(e => e.PhysicalStatus)
            .IsRequired()
            .HasDefaultValue(AccessorySerialPhysicalStatus.InWarehouse);

        builder.HasIndex(e => new { e.EquipmentType, e.SerialCode })
            .IsUnique()
            .HasDatabaseName("IX_AccessorySerialInventory_Type_Code");

        builder.HasIndex(e => new { e.EquipmentType, e.PhysicalStatus })
            .HasDatabaseName("IX_AccessorySerialInventory_Type_PhysicalStatus");
    }
}
