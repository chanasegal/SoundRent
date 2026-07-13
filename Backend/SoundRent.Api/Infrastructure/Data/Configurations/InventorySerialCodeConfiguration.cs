using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class InventorySerialCodeConfiguration : IEntityTypeConfiguration<InventorySerialCode>
{
    public void Configure(EntityTypeBuilder<InventorySerialCode> builder)
    {
        builder.ToTable("InventorySerialCodes");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.SerialCode)
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(e => e.PhysicalStatus)
            .IsRequired()
            .HasDefaultValue(AccessorySerialPhysicalStatus.InWarehouse);

        builder.HasIndex(e => new { e.InventoryDefinitionId, e.SerialCode })
            .IsUnique()
            .HasDatabaseName("IX_InventorySerialCodes_Definition_Code");

        builder.HasIndex(e => e.InventoryDefinitionId)
            .HasDatabaseName("IX_InventorySerialCodes_InventoryDefinitionId");
    }
}
