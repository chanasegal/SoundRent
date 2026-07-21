using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class CustomerDebtConfiguration : IEntityTypeConfiguration<CustomerDebt>
{
    public void Configure(EntityTypeBuilder<CustomerDebt> builder)
    {
        builder.ToTable("CustomerDebts");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.CustomerName).HasMaxLength(200);
        builder.Property(e => e.Phone).HasMaxLength(20).IsRequired();
        builder.Property(e => e.Address).HasMaxLength(300);
        builder.Property(e => e.Amount).HasPrecision(18, 2);
        builder.Property(e => e.ItemDescription).HasMaxLength(300);
        builder.Property(e => e.Deposit).HasMaxLength(500);
        builder.Property(e => e.SessionKey).HasMaxLength(80);
        builder.Property(e => e.Category).HasConversion<int>();

        builder.HasIndex(e => e.IsPaid).HasDatabaseName("IX_CustomerDebts_IsPaid");
        builder.HasIndex(e => e.SessionKey).HasDatabaseName("IX_CustomerDebts_SessionKey");
        builder.HasIndex(e => e.Phone).HasDatabaseName("IX_CustomerDebts_Phone");
        builder.HasIndex(e => e.ChargedAt).HasDatabaseName("IX_CustomerDebts_ChargedAt");
        builder.HasIndex(e => e.ToolLoanItemId).HasDatabaseName("IX_CustomerDebts_ToolLoanItemId");
        builder.HasIndex(e => e.BookLoanItemId).HasDatabaseName("IX_CustomerDebts_BookLoanItemId");

        builder.HasOne(e => e.ToolLoanItem)
            .WithOne(i => i.CustomerDebt)
            .HasForeignKey<CustomerDebt>(e => e.ToolLoanItemId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.HasOne(e => e.BookLoanItem)
            .WithOne(i => i.CustomerDebt)
            .HasForeignKey<CustomerDebt>(e => e.BookLoanItemId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
