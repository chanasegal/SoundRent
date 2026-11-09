using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class BookCopyConfiguration : IEntityTypeConfiguration<BookCopy>
{
    public void Configure(EntityTypeBuilder<BookCopy> builder)
    {
        builder.ToTable("BookCopies");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.CopyNumber)
            .HasMaxLength(100)
            .IsRequired();

        builder.HasIndex(e => e.BookId)
            .HasDatabaseName("IX_BookCopies_BookId");

        // Global barcode lookup (LocateSerial without a book scope).
        builder.HasIndex(e => e.CopyNumber)
            .HasDatabaseName("IX_BookCopies_CopyNumber");

        builder.HasIndex(e => new { e.BookId, e.CopyNumber })
            .IsUnique()
            .HasDatabaseName("IX_BookCopies_BookId_CopyNumber");
    }
}
