using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class ManualUnreturnedItemConfiguration : IEntityTypeConfiguration<ManualUnreturnedItem>
{
    public void Configure(EntityTypeBuilder<ManualUnreturnedItem> builder)
    {
        builder.ToTable("ManualUnreturnedItems");
        builder.HasKey(e => e.Id);

        builder.Property(e => e.CustomerName).HasMaxLength(200);
        builder.Property(e => e.Phone).HasMaxLength(20);
        builder.Property(e => e.Address).HasMaxLength(200);
        builder.Property(e => e.ItemName).HasMaxLength(200).IsRequired();
        builder.Property(e => e.ItemCode).HasMaxLength(100);
        builder.Property(e => e.LoanedEquipmentType).HasConversion<int?>();

        builder.HasIndex(e => e.IsResolved).HasDatabaseName("IX_ManualUnreturnedItems_IsResolved");
        builder.HasIndex(e => e.CreatedAt).HasDatabaseName("IX_ManualUnreturnedItems_CreatedAt");
        builder.HasIndex(e => e.OrderId).HasDatabaseName("IX_ManualUnreturnedItems_OrderId");
        builder.HasIndex(e => new { e.ItemCode, e.IsResolved })
            .HasDatabaseName("IX_ManualUnreturnedItems_Code_Resolved");

        builder.HasOne(e => e.Order)
            .WithMany()
            .HasForeignKey(e => e.OrderId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.HasOne(e => e.InventoryDefinition)
            .WithMany()
            .HasForeignKey(e => e.InventoryDefinitionId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
