using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class WaitlistEntryConfiguration : IEntityTypeConfiguration<WaitlistEntry>
{
    public void Configure(EntityTypeBuilder<WaitlistEntry> builder)
    {
        builder.ToTable("WaitlistEntries");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.CustomerName)
            .HasMaxLength(100);

        builder.Property(e => e.Phone)
            .IsRequired()
            .HasMaxLength(20);

        builder.Property(e => e.Notes)
            .HasMaxLength(1000);

        builder.Property(e => e.WaitlistDate)
            .HasColumnType("date");

        builder.Property(e => e.CreatedAt)
            .HasDefaultValueSql("CURRENT_TIMESTAMP");

        builder.Property(e => e.SystemType)
            .HasDefaultValue(SystemType.Sound)
            .IsRequired();

        builder.HasIndex(e => new { e.EquipmentType, e.WaitlistDate })
            .HasDatabaseName("IX_WaitlistEntries_Equipment_Date");

        builder.HasIndex(e => e.WaitlistDate)
            .HasDatabaseName("IX_WaitlistEntries_WaitlistDate");

        builder.HasIndex(e => e.SystemType)
            .HasDatabaseName("IX_WaitlistEntries_SystemType");
    }
}
