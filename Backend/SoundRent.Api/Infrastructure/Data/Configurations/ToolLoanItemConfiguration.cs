using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class ToolLoanItemConfiguration : IEntityTypeConfiguration<ToolLoanItem>
{
    public void Configure(EntityTypeBuilder<ToolLoanItem> builder)
    {
        builder.ToTable("ToolLoanItems");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.ToolName).HasMaxLength(200).IsRequired();
        builder.Property(e => e.SerialCode).HasMaxLength(100).IsRequired();
        builder.Property(e => e.HebrewReturnedDisplay).HasMaxLength(120);
        builder.Property(e => e.ChargeAmount).HasPrecision(18, 2);

        builder.HasIndex(e => e.ToolLoanId).HasDatabaseName("IX_ToolLoanItems_ToolLoanId");
        builder.HasIndex(e => e.SerialCode).HasDatabaseName("IX_ToolLoanItems_SerialCode");
        builder.HasIndex(e => e.ToolDefinitionId).HasDatabaseName("IX_ToolLoanItems_ToolDefinitionId");
        builder.HasIndex(e => e.ReturnedAt).HasDatabaseName("IX_ToolLoanItems_ReturnedAt");
    }
}
