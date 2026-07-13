using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class ToolSerialCodeConfiguration : IEntityTypeConfiguration<ToolSerialCode>
{
    public void Configure(EntityTypeBuilder<ToolSerialCode> builder)
    {
        builder.ToTable("ToolSerialCodes");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.SerialCode)
            .HasMaxLength(100)
            .IsRequired();

        builder.HasIndex(e => e.ToolDefinitionId)
            .HasDatabaseName("IX_ToolSerialCodes_ToolDefinitionId");

        builder.HasIndex(e => new { e.ToolDefinitionId, e.SerialCode })
            .IsUnique()
            .HasDatabaseName("IX_ToolSerialCodes_ToolDefinitionId_SerialCode");
    }
}
