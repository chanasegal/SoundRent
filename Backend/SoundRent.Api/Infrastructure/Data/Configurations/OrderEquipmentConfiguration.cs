using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data.Configurations;

public class OrderEquipmentConfiguration : IEntityTypeConfiguration<OrderEquipment>
{
    public void Configure(EntityTypeBuilder<OrderEquipment> builder)
    {
        builder.ToTable("OrderEquipments");

        builder.HasKey(oe => new { oe.OrderId, oe.EquipmentDefinitionId });

        builder.Property(oe => oe.EquipmentDefinitionId)
            .HasMaxLength(64)
            .IsRequired();

        builder.HasIndex(oe => oe.EquipmentDefinitionId)
            .HasDatabaseName("IX_OrderEquipments_EquipmentDefinitionId");

        builder.HasOne(oe => oe.Order)
            .WithMany(o => o.Equipments)
            .HasForeignKey(oe => oe.OrderId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasOne(oe => oe.EquipmentDefinition)
            .WithMany(e => e.Orders)
            .HasForeignKey(oe => oe.EquipmentDefinitionId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
