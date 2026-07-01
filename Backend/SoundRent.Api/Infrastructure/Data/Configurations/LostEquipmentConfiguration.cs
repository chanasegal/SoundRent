using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class LostEquipmentConfiguration : IEntityTypeConfiguration<LostEquipment>
{
    public void Configure(EntityTypeBuilder<LostEquipment> builder)
    {
        builder.ToTable("LostEquipments");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.CustomerName)
            .HasMaxLength(200)
            .IsRequired();

        builder.Property(e => e.ItemDescription)
            .HasMaxLength(500)
            .IsRequired();

        builder.Property(e => e.HebrewDate)
            .HasMaxLength(100)
            .IsRequired();

        builder.Property(e => e.Notes)
            .HasMaxLength(2000);

        builder.Property(e => e.Status)
            .HasDefaultValue(LostEquipmentStatus.Pending);

        builder.Property(e => e.CreatedAt)
            .HasDefaultValueSql("CURRENT_TIMESTAMP");

        builder.Property(e => e.UpdatedAt)
            .HasDefaultValueSql("CURRENT_TIMESTAMP");

        builder.HasIndex(e => e.Status)
            .HasDatabaseName("IX_LostEquipments_Status");

        builder.HasIndex(e => e.CreatedAt)
            .HasDatabaseName("IX_LostEquipments_CreatedAt");
    }
}
