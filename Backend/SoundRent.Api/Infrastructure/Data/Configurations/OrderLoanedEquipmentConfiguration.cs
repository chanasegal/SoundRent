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

        builder.Property(le => le.IsCustomItem)
            .IsRequired()
            .HasDefaultValue(false);

        builder.Property(le => le.CustomItemName)
            .HasMaxLength(200);

        builder.Property(le => le.Quantity)
            .IsRequired();

        builder.Property(le => le.ReturnedQuantity)
            .IsRequired()
            .HasDefaultValue(0);

        builder.Property(le => le.ExpectedNoteCount)
            .IsRequired();

        builder.HasIndex(le => le.OrderId)
            .HasDatabaseName("IX_OrderLoanedEquipments_OrderId");

        builder.HasIndex(le => new { le.OrderId, le.LoanedEquipmentType })
            .IsUnique()
            .HasFilter("\"IsCustomItem\" = false")
            .HasDatabaseName("IX_OrderLoanedEquipments_Order_Type_Unique");
    }
}
