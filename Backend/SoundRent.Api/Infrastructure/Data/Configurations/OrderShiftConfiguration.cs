using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class OrderShiftConfiguration : IEntityTypeConfiguration<OrderShift>
{
    public void Configure(EntityTypeBuilder<OrderShift> builder)
    {
        builder.ToTable("OrderShifts");

        builder.HasKey(os => new { os.OrderId, os.OrderDate, os.TimeSlot });

        builder.Property(os => os.OrderDate)
            .HasColumnType("date");

        builder.HasIndex(os => new { os.OrderDate, os.TimeSlot })
            .HasDatabaseName("IX_OrderShifts_Date_TimeSlot");

        builder.HasIndex(os => new { os.OrderDate, os.TimeSlot, os.OrderId })
            .HasDatabaseName("IX_OrderShifts_Date_TimeSlot_OrderId");

        builder.HasOne(os => os.Order)
            .WithMany(o => o.Shifts)
            .HasForeignKey(os => os.OrderId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
