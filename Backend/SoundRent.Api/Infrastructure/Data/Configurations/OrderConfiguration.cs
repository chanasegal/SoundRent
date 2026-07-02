using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class OrderConfiguration : IEntityTypeConfiguration<Order>
{
    public void Configure(EntityTypeBuilder<Order> builder)
    {
        builder.ToTable("Orders");

        builder.HasKey(o => o.Id);

        builder.Property(o => o.CustomerName)
            .HasMaxLength(100);

        builder.Property(o => o.Phone)
            .IsRequired()
            .HasMaxLength(20);

        builder.Property(o => o.Phone2)
            .HasMaxLength(20);

        builder.Property(o => o.Address)
            .HasMaxLength(200);

        builder.Property(o => o.DepositOnName)
            .HasMaxLength(100);

        builder.Property(o => o.PaymentAmount)
            .HasColumnType("decimal(18,2)");

        builder.Property(o => o.IsUnpaid)
            .HasDefaultValue(false);

        builder.Property(o => o.IsCancelled)
            .HasDefaultValue(false);

        builder.Property(o => o.ReturnTimeType)
            .HasDefaultValue(ReturnTimeType.LateNight);

        builder.Property(o => o.CustomReturnTime)
            .HasMaxLength(20);

        builder.Property(o => o.Notes)
            .HasMaxLength(1000);

        builder.Property(o => o.CreatedAt)
            .HasDefaultValueSql("CURRENT_TIMESTAMP");

        builder.HasIndex(o => o.Phone)
            .HasDatabaseName("IX_Orders_Phone");

        builder.HasIndex(o => o.Phone2)
            .HasDatabaseName("IX_Orders_Phone2")
            .HasFilter("\"Phone2\" IS NOT NULL");

        builder.HasIndex(o => o.IsCancelled)
            .HasDatabaseName("IX_Orders_IsCancelled");

        builder.HasIndex(o => o.IsUnpaid)
            .HasDatabaseName("IX_Orders_IsUnpaid");

        builder.HasMany(o => o.Equipments)
            .WithOne(e => e.Order)
            .HasForeignKey(e => e.OrderId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(o => o.Shifts)
            .WithOne(s => s.Order)
            .HasForeignKey(s => s.OrderId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(o => o.LoanedEquipments)
            .WithOne(le => le.Order)
            .HasForeignKey(le => le.OrderId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
