using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class InventoryDefinitionConfiguration : IEntityTypeConfiguration<InventoryDefinition>
{
    public void Configure(EntityTypeBuilder<InventoryDefinition> builder)
    {
        builder.ToTable("InventoryDefinitions");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.DisplayName)
            .HasMaxLength(200)
            .IsRequired();

        builder.Property(e => e.CreatedAt)
            .HasDefaultValueSql("CURRENT_TIMESTAMP");

        builder.Property(e => e.UpdatedAt)
            .HasDefaultValueSql("CURRENT_TIMESTAMP");

        builder.HasIndex(e => e.DisplayName)
            .IsUnique()
            .HasDatabaseName("IX_InventoryDefinitions_DisplayName");

        builder.HasIndex(e => e.SortOrder)
            .HasDatabaseName("IX_InventoryDefinitions_SortOrder");

        builder.HasIndex(e => e.LinkedEquipmentType)
            .IsUnique()
            .HasFilter("\"LinkedEquipmentType\" IS NOT NULL")
            .HasDatabaseName("IX_InventoryDefinitions_LinkedEquipmentType");

        builder.HasMany(e => e.SerialCodes)
            .WithOne(s => s.InventoryDefinition)
            .HasForeignKey(s => s.InventoryDefinitionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
