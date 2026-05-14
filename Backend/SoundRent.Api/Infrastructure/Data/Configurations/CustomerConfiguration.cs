using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class CustomerConfiguration : IEntityTypeConfiguration<Customer>
{
    public void Configure(EntityTypeBuilder<Customer> builder)
    {
        builder.ToTable("Customers");

        builder.HasKey(c => c.Phone1);

        builder.Property(c => c.Phone1)
            .HasMaxLength(20)
            .IsRequired();

        builder.Property(c => c.Phone2)
            .HasMaxLength(20);

        builder.Property(c => c.FullName)
            .HasMaxLength(200);

        builder.Property(c => c.Address)
            .HasMaxLength(500);

        builder.Property(c => c.Notes)
            .HasMaxLength(4000);

        builder.Property(c => c.UpdatedAt)
            .HasDefaultValueSql("CURRENT_TIMESTAMP");

        builder.HasIndex(c => c.Phone2)
            .HasDatabaseName("IX_Customers_Phone2")
            .HasFilter("\"Phone2\" IS NOT NULL");
    }
}
