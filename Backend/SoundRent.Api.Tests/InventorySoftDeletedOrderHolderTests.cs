using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using SoundRent.Api.Application.Services;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Tests;

/// <summary>
/// Soft-deleted orders keep unreturned notes for cash-deposit FKs, but must not keep
/// inventory serials marked as taken by that customer in the management / availability UI.
/// </summary>
public class InventorySoftDeletedOrderHolderTests
{
    [Fact]
    public async Task GetAllAsync_DoesNotShowHolder_WhenOrderIsSoftDeleted()
    {
        await using var harness = await CreateHarnessAsync();
        var db = harness.Db;

        db.InventoryDefinitions.Add(new InventoryDefinition
        {
            Id = 10,
            DisplayName = "כבל מאריך",
            IsActive = true,
            Quantity = 1,
            SerialCodes =
            [
                new InventorySerialCode
                {
                    SerialCode = "2",
                    PhysicalStatus = AccessorySerialPhysicalStatus.LoanedOut
                }
            ]
        });

        db.Orders.Add(new Order
        {
            Id = 77,
            CustomerName = "בב",
            Phone = "0501112233",
            IsCancelled = false,
            IsDeleted = true,
            DeletedAt = DateTime.UtcNow,
            SystemType = SystemType.Sound,
            Shifts =
            [
                new OrderShift { OrderDate = new DateOnly(2026, 10, 1), TimeSlot = TimeSlot.Morning }
            ],
            LoanedEquipments =
            [
                new OrderLoanedEquipment
                {
                    InventoryDefinitionId = 10,
                    Quantity = 1,
                    ReturnedQuantity = 0,
                    ExpectedNoteCount = 1,
                    Notes =
                    [
                        new LoanedEquipmentNote
                        {
                            Ordinal = 0,
                            Content = "2",
                            IsReturned = false
                        }
                    ]
                }
            ]
        });

        await db.SaveChangesAsync();

        var service = new InventoryDefinitionService(
            new InventoryDefinitionRepository(db),
            db,
            NullLogger<InventoryDefinitionService>.Instance);

        var catalog = await service.GetAllAsync();
        var def = Assert.Single(catalog, d => d.Id == 10);
        var unit = Assert.Single(def.SerialUnits);
        Assert.Equal("2", unit.SerialCode);
        Assert.Equal(AccessorySerialPhysicalStatus.InWarehouse, unit.PhysicalStatus);
        Assert.True(string.IsNullOrWhiteSpace(unit.HolderCustomerName));
        Assert.Empty(def.ActiveHolders);

        var persisted = await db.InventorySerialCodes.SingleAsync(s => s.SerialCode == "2");
        Assert.Equal(AccessorySerialPhysicalStatus.InWarehouse, persisted.PhysicalStatus);
    }

    [Fact]
    public async Task GetAvailabilityAsync_MarksSerialAvailable_WhenOnlySoftDeletedOrderHoldsIt()
    {
        await using var harness = await CreateHarnessAsync();
        var db = harness.Db;

        db.InventoryDefinitions.Add(new InventoryDefinition
        {
            Id = 11,
            DisplayName = "כבל מאריך",
            IsActive = true,
            Quantity = 1,
            SerialCodes =
            [
                new InventorySerialCode
                {
                    SerialCode = "2",
                    PhysicalStatus = AccessorySerialPhysicalStatus.LoanedOut
                }
            ]
        });

        db.Orders.Add(new Order
        {
            Id = 88,
            CustomerName = "בב",
            Phone = "0501112233",
            IsCancelled = false,
            IsDeleted = true,
            DeletedAt = DateTime.UtcNow,
            SystemType = SystemType.Sound,
            LoanedEquipments =
            [
                new OrderLoanedEquipment
                {
                    InventoryDefinitionId = 11,
                    Quantity = 1,
                    Notes =
                    [
                        new LoanedEquipmentNote
                        {
                            Ordinal = 0,
                            Content = "2",
                            IsReturned = false
                        }
                    ]
                }
            ]
        });

        await db.SaveChangesAsync();

        var service = new InventoryDefinitionService(
            new InventoryDefinitionRepository(db),
            db,
            NullLogger<InventoryDefinitionService>.Instance);

        var groups = await service.GetAvailabilityAsync(new Application.DTOs.InventorySerialAvailabilityRequestDto
        {
            InventoryDefinitionIds = [11]
        });

        var group = Assert.Single(groups);
        var option = Assert.Single(group.Options);
        Assert.Equal("2", option.SerialCode);
        Assert.True(option.IsAvailable);
    }

    private static async Task<SqliteHarness> CreateHarnessAsync()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        var db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();
        return new SqliteHarness(db, connection);
    }

    private sealed class SqliteHarness(AppDbContext db, SqliteConnection connection) : IAsyncDisposable
    {
        public AppDbContext Db { get; } = db;

        public async ValueTask DisposeAsync()
        {
            await Db.DisposeAsync();
            await connection.DisposeAsync();
        }
    }
}
