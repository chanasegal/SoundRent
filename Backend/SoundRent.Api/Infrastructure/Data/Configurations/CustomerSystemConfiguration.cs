using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class CustomerSystemConfiguration : IEntityTypeConfiguration<CustomerSystem>
{
    public void Configure(EntityTypeBuilder<CustomerSystem> builder)
    {
        builder.ToTable("CustomerSystems");

        builder.HasKey(cs => new { cs.CustomerPhone1, cs.SystemType });

        builder.Property(cs => cs.CustomerPhone1)
            .HasMaxLength(20)
            .IsRequired();

        builder.Property(cs => cs.SystemType)
            .IsRequired();

        builder.Property(cs => cs.LinkedAt)
            .HasDefaultValueSql("CURRENT_TIMESTAMP");

        builder.HasIndex(cs => cs.SystemType)
            .HasDatabaseName("IX_CustomerSystems_SystemType");

        builder.HasOne(cs => cs.Customer)
            .WithMany(c => c.Systems)
            .HasForeignKey(cs => cs.CustomerPhone1)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
