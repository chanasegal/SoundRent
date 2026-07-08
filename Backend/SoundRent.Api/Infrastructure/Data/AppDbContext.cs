using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderEquipment> OrderEquipments => Set<OrderEquipment>();
    public DbSet<OrderShift> OrderShifts => Set<OrderShift>();
    public DbSet<OrderLoanedEquipment> OrderLoanedEquipments => Set<OrderLoanedEquipment>();
    public DbSet<OrderCustomMissingItem> OrderCustomMissingItems => Set<OrderCustomMissingItem>();
    public DbSet<LoanedEquipmentNote> LoanedEquipmentNotes => Set<LoanedEquipmentNote>();
    public DbSet<Equipment> Equipments => Set<Equipment>();
    public DbSet<User> Users => Set<User>();
    public DbSet<WaitlistEntry> WaitlistEntries => Set<WaitlistEntry>();
    public DbSet<EquipmentDefinition> EquipmentDefinitions => Set<EquipmentDefinition>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<GeneralMemo> GeneralMemos => Set<GeneralMemo>();
    public DbSet<LostEquipment> LostEquipments => Set<LostEquipment>();
    public DbSet<BlockedDate> BlockedDates => Set<BlockedDate>();
    public DbSet<AccessorySerialInventory> AccessorySerialInventory => Set<AccessorySerialInventory>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
    }
}
