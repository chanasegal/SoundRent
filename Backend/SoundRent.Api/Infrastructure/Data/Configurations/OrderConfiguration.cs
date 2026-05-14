using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

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

        builder.Property(o => o.Notes)
            .HasMaxLength(1000);

        builder.Property(o => o.OrderDate)
            .HasColumnType("date");

        builder.Property(o => o.EquipmentType)
            .HasMaxLength(64)
            .IsRequired();

        builder.Property(o => o.CreatedAt)
            .HasDefaultValueSql("CURRENT_TIMESTAMP");

        // Non-unique index for listing/filtering; double-booking is allowed when explicitly confirmed via API.
        builder.HasIndex(o => new { o.EquipmentType, o.OrderDate, o.TimeSlot })
            .HasDatabaseName("IX_Orders_Equipment_Date_TimeSlot");

        builder.HasMany(o => o.LoanedEquipments)
            .WithOne(le => le.Order)
            .HasForeignKey(le => le.OrderId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
