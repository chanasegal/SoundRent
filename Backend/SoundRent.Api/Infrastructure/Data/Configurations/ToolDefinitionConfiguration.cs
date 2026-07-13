using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class ToolDefinitionConfiguration : IEntityTypeConfiguration<ToolDefinition>
{
    public void Configure(EntityTypeBuilder<ToolDefinition> builder)
    {
        builder.ToTable("ToolDefinitions");

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
            .HasDatabaseName("IX_ToolDefinitions_DisplayName");

        builder.HasIndex(e => e.SortOrder)
            .HasDatabaseName("IX_ToolDefinitions_SortOrder");

        builder.HasMany(e => e.SerialCodes)
            .WithOne(s => s.ToolDefinition)
            .HasForeignKey(s => s.ToolDefinitionId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
