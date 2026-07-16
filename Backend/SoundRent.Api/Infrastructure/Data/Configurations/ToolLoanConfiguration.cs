using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class ToolLoanConfiguration : IEntityTypeConfiguration<ToolLoan>
{
    public void Configure(EntityTypeBuilder<ToolLoan> builder)
    {
        builder.ToTable("ToolLoans");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.HebrewLentDisplay).HasMaxLength(120);
        builder.Property(e => e.ClientName).HasMaxLength(200);
        builder.Property(e => e.Phone).HasMaxLength(20).IsRequired();
        builder.Property(e => e.Phone2).HasMaxLength(20);
        builder.Property(e => e.Address).HasMaxLength(500);
        builder.Property(e => e.Deposit).HasMaxLength(500);
        builder.Property(e => e.Notes).HasMaxLength(2000);
        builder.Property(e => e.HebrewReturnedDisplay).HasMaxLength(120);

        builder.Property(e => e.CreatedAt).HasDefaultValueSql("CURRENT_TIMESTAMP");
        builder.Property(e => e.UpdatedAt).HasDefaultValueSql("CURRENT_TIMESTAMP");

        builder.HasIndex(e => e.ReturnedAt).HasDatabaseName("IX_ToolLoans_ReturnedAt");
        builder.HasIndex(e => e.LentAt).HasDatabaseName("IX_ToolLoans_LentAt");
        builder.HasIndex(e => e.Phone).HasDatabaseName("IX_ToolLoans_Phone");

        builder.HasMany(e => e.Items)
            .WithOne(i => i.ToolLoan)
            .HasForeignKey(i => i.ToolLoanId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
