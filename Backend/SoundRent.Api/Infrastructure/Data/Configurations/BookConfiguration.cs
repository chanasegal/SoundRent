using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class BookConfiguration : IEntityTypeConfiguration<Book>
{
    public void Configure(EntityTypeBuilder<Book> builder)
    {
        builder.ToTable("Books");

        builder.HasKey(e => e.Id);

        builder.Property(e => e.Title)
            .HasMaxLength(200)
            .IsRequired();

        builder.Property(e => e.Author).HasMaxLength(200);
        builder.Property(e => e.Category).HasMaxLength(100);

        builder.Property(e => e.CreatedAt)
            .HasDefaultValueSql("CURRENT_TIMESTAMP");

        builder.Property(e => e.UpdatedAt)
            .HasDefaultValueSql("CURRENT_TIMESTAMP");

        builder.HasIndex(e => e.Title)
            .IsUnique()
            .HasDatabaseName("IX_Books_Title");

        builder.HasIndex(e => e.SortOrder)
            .HasDatabaseName("IX_Books_SortOrder");

        builder.HasMany(e => e.Copies)
            .WithOne(s => s.Book)
            .HasForeignKey(s => s.BookId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
