using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class BookLoanItemConfiguration : IEntityTypeConfiguration<BookLoanItem>
{
    public void Configure(EntityTypeBuilder<BookLoanItem> builder)
    {
        builder.ToTable("BookLoanItems");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.BookTitle).HasMaxLength(200).IsRequired();
        builder.Property(e => e.CopyNumber).HasMaxLength(100).IsRequired();
        builder.Property(e => e.HebrewReturnedDisplay).HasMaxLength(120);
        builder.Property(e => e.ChargeAmount).HasPrecision(18, 2);

        builder.HasIndex(e => e.BookLoanId).HasDatabaseName("IX_BookLoanItems_BookLoanId");
        builder.HasIndex(e => e.CopyNumber).HasDatabaseName("IX_BookLoanItems_CopyNumber");
        builder.HasIndex(e => e.BookId).HasDatabaseName("IX_BookLoanItems_BookId");
        builder.HasIndex(e => e.ReturnedAt).HasDatabaseName("IX_BookLoanItems_ReturnedAt");
    }
}
