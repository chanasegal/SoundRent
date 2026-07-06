using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class OrderCustomMissingItemConfiguration : IEntityTypeConfiguration<OrderCustomMissingItem>
{
    public void Configure(EntityTypeBuilder<OrderCustomMissingItem> builder)
    {
        builder.ToTable("OrderCustomMissingItems");

        builder.HasKey(i => i.Id);

        builder.Property(i => i.ItemName)
            .IsRequired()
            .HasMaxLength(200);

        builder.Property(i => i.MissingQuantity)
            .IsRequired();

        builder.Property(i => i.IsResolved)
            .IsRequired()
            .HasDefaultValue(false);

        builder.HasIndex(i => new { i.OrderId, i.IsResolved })
            .HasDatabaseName("IX_OrderCustomMissingItems_Order_Resolved");
    }
}
