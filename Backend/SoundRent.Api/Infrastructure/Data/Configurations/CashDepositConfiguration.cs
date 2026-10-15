using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class CashDepositConfiguration : IEntityTypeConfiguration<CashDeposit>
{
    public void Configure(EntityTypeBuilder<CashDeposit> builder)
    {
        builder.ToTable("CashDeposits");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.CustomerName).HasMaxLength(200);
        builder.Property(e => e.Phone).HasMaxLength(20).IsRequired();
        builder.Property(e => e.Address).HasMaxLength(500);
        builder.Property(e => e.Amount).HasPrecision(18, 2);
        builder.Property(e => e.Notes).HasMaxLength(1000);
        builder.Property(e => e.SourceModule).HasConversion<int>();
        builder.Property(e => e.Status).HasConversion<int>();
        builder.Property(e => e.CreatedAt).HasDefaultValueSql("CURRENT_TIMESTAMP");

        builder.HasIndex(e => e.Status).HasDatabaseName("IX_CashDeposits_Status");
        builder.HasIndex(e => e.Phone).HasDatabaseName("IX_CashDeposits_Phone");
        builder.HasIndex(e => e.OrderId).HasDatabaseName("IX_CashDeposits_OrderId");
        builder.HasIndex(e => e.ToolLoanId).HasDatabaseName("IX_CashDeposits_ToolLoanId");
        builder.HasIndex(e => e.BookLoanId).HasDatabaseName("IX_CashDeposits_BookLoanId");
    }
}
