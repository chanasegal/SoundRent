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

        builder.Property(o => o.InstitutionName)
            .HasMaxLength(200);

        builder.HasOne(o => o.Institution)
            .WithMany(i => i.Orders)
            .HasForeignKey(o => o.InstitutionId)
            .OnDelete(DeleteBehavior.SetNull);

        builder.HasIndex(o => o.InstitutionId)
            .HasDatabaseName("IX_Orders_InstitutionId");

        builder.Property(o => o.DepositOnName)
            .HasMaxLength(100);

        builder.Property(o => o.CashDepositAmount)
            .HasColumnType("decimal(18,2)");

        builder.Property(o => o.DepositReturned)
            .HasDefaultValue(false);

        builder.Property(o => o.PaymentAmount)
            .HasColumnType("decimal(18,2)");

        builder.Property(o => o.IsPaid)
            .HasDefaultValue(false);

        builder.Property(o => o.IsUnpaid)
            .HasDefaultValue(false);

        builder.Property(o => o.IsCancelled)
            .HasDefaultValue(false);

        builder.Property(o => o.IsDeleted)
            .HasDefaultValue(false);

        builder.Property(o => o.IsReturnProcessed)
            .HasDefaultValue(false);

        // Soft-delete is enforced in OrderRepository (not a global query filter):
        // string-based model snapshots treat Entity("…Order") as Dictionary<string,object>,
        // so HasQueryFilter((Order o) => …) breaks Migrate() / HasPendingModelChanges().

        builder.HasIndex(o => o.IsDeleted)
            .HasDatabaseName("IX_Orders_IsDeleted");

        // Sentinel 0 is not a named enum member; DB default LateNight applies only when unset.
        builder.Property(o => o.ReturnTimeType)
            .HasDefaultValue(ReturnTimeType.LateNight)
            .HasSentinel(default(ReturnTimeType));

        builder.Property(o => o.CustomReturnTime)
            .HasMaxLength(20);

        builder.Property(o => o.Notes)
            .HasMaxLength(1000);

        builder.Property(o => o.UrgentBoardNote)
            .HasMaxLength(1000);

        builder.Property(o => o.CreatedAt)
            .HasDefaultValueSql("CURRENT_TIMESTAMP");

        builder.Property(o => o.SystemType)
            .HasDefaultValue(SystemType.Sound)
            .IsRequired();

        builder.HasIndex(o => o.Phone)
            .HasDatabaseName("IX_Orders_Phone");

        builder.HasIndex(o => o.Phone2)
            .HasDatabaseName("IX_Orders_Phone2")
            .HasFilter("\"Phone2\" IS NOT NULL");

        builder.HasIndex(o => o.IsCancelled)
            .HasDatabaseName("IX_Orders_IsCancelled");

        builder.HasIndex(o => o.IsUnpaid)
            .HasDatabaseName("IX_Orders_IsUnpaid");

        builder.HasIndex(o => o.SystemType)
            .HasDatabaseName("IX_Orders_SystemType");

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

        builder.HasMany(o => o.CustomMissingItems)
            .WithOne(i => i.Order)
            .HasForeignKey(i => i.OrderId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasMany(o => o.CashDeposits)
            .WithOne(d => d.Order)
            .HasForeignKey(d => d.OrderId)
            .OnDelete(DeleteBehavior.Restrict);
    }
}
