using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class GeneralMemoConfiguration : IEntityTypeConfiguration<GeneralMemo>
{
    public void Configure(EntityTypeBuilder<GeneralMemo> builder)
    {
        builder.ToTable("GeneralMemos");

        builder.HasKey(m => m.Id);

        builder.Property(m => m.Content)
            .HasMaxLength(8000)
            .HasDefaultValue(string.Empty);

        builder.Property(m => m.UpdatedAt)
            .HasDefaultValueSql("CURRENT_TIMESTAMP");

        builder.HasData(new GeneralMemo
        {
            Id = GeneralMemo.SingletonId,
            Content = string.Empty,
            UpdatedAt = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc)
        });
    }
}
