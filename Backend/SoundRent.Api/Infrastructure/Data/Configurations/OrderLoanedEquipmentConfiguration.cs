using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class OrderLoanedEquipmentConfiguration : IEntityTypeConfiguration<OrderLoanedEquipment>
{
    public void Configure(EntityTypeBuilder<OrderLoanedEquipment> builder)
    {
        builder.ToTable("OrderLoanedEquipments");

        builder.HasKey(le => le.Id);

        builder.Property(le => le.Quantity)
            .IsRequired();

        builder.Property(le => le.ExpectedNoteCount)
            .IsRequired();

        // Prevent the same loaned equipment type appearing twice on the same order.
        builder.HasIndex(le => new { le.OrderId, le.LoanedEquipmentType })
            .IsUnique()
            .HasDatabaseName("IX_OrderLoanedEquipments_Order_Type_Unique");
    }
}
