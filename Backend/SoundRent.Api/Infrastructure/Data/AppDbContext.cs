using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderLoanedEquipment> OrderLoanedEquipments => Set<OrderLoanedEquipment>();
    public DbSet<LoanedEquipmentNote> LoanedEquipmentNotes => Set<LoanedEquipmentNote>();
    public DbSet<LoanedEquipmentTypeNoteDefault> LoanedEquipmentTypeNoteDefaults => Set<LoanedEquipmentTypeNoteDefault>();
    public DbSet<Equipment> Equipments => Set<Equipment>();
    public DbSet<User> Users => Set<User>();
    public DbSet<WaitlistEntry> WaitlistEntries => Set<WaitlistEntry>();
    public DbSet<EquipmentDefinition> EquipmentDefinitions => Set<EquipmentDefinition>();
    public DbSet<Customer> Customers => Set<Customer>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
    }
}
