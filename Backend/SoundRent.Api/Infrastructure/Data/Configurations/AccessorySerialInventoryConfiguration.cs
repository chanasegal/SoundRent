using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

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

        builder.HasIndex(e => new { e.EquipmentType, e.SerialCode })
            .IsUnique()
            .HasDatabaseName("IX_AccessorySerialInventory_Type_Code");
    }
}
