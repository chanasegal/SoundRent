using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.Services;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;
using SoundRent.Api.Infrastructure.Repositories;

namespace SoundRent.Api.Tests;

public class OrderQuickLoansRegressionTests
{
    [Fact]
    public async Task GetQuickLoansAsync_IncludesSerializedMultiDayLoan_WhenAggregateReturnStateIsStale()
    {
        await using var harness = await CreateSqliteHarnessAsync();
        var db = harness.Db;

        db.InventoryDefinitions.Add(new InventoryDefinition
        {
            Id = 101,
            DisplayName = "Adapter",
            IsActive = true
        });

        db.Orders.Add(new Order
        {
            Id = 501,
            CustomerName = "Serialized Borrower",
            Phone = "0501234567",
            Address = "Jerusalem",
            SystemType = SystemType.Tools,
            IsCancelled = false,
            // Deliberately stale to reproduce the orphan mismatch:
            // the serial note is still active, but the aggregate flags say "returned".
            IsReturnProcessed = true,
            Shifts =
            [
                new OrderShift { OrderDate = new DateOnly(2026, 9, 5), TimeSlot = TimeSlot.Morning },
                new OrderShift { OrderDate = new DateOnly(2026, 9, 6), TimeSlot = TimeSlot.Evening },
                new OrderShift { OrderDate = new DateOnly(2026, 9, 7), TimeSlot = TimeSlot.Morning }
            ],
            LoanedEquipments =
            [
                new OrderLoanedEquipment
                {
                    Id = 9001,
                    InventoryDefinitionId = 101,
                    Quantity = 1,
                    ReturnedQuantity = 1,
                    ExpectedNoteCount = 1,
                    Notes =
                    [
                        new LoanedEquipmentNote
                        {
                            Ordinal = 0,
                            Content = "ACC-42",
                            IsReturned = false
                        }
                    ]
                }
            ]
        });

        await db.SaveChangesAsync();

        var repository = new OrderRepository(db);
        var quickLoans = await repository.GetQuickLoansAsync(SystemType.Tools);

        var match = Assert.Single(quickLoans);
        Assert.Equal(501, match.Id);
        var line = Assert.Single(match.LoanedEquipments);
        var note = Assert.Single(line.Notes);
        Assert.Equal("ACC-42", note.Content);
        Assert.False(note.IsReturned);
    }

    [Fact]
    public async Task GetQuickLoansAsync_ForSound_IncludesToolsAccessoryOnlyLoans()
    {
        await using var harness = await CreateSqliteHarnessAsync();
        var db = harness.Db;

        db.EquipmentDefinitions.Add(new EquipmentDefinition
        {
            Id = "tools-board",
            DisplayName = "Tools Board",
            Category = "Tools",
            SystemType = SystemType.Tools
        });

        db.Orders.AddRange(
            CreateOutstandingLoan(601, SystemType.Sound),
            CreateOutstandingLoan(602, SystemType.Tools),
            CreateOutstandingLoan(603, SystemType.Tools, equipmentDefinitionId: "tools-board"),
            CreateOutstandingLoan(604, SystemType.Library));

        await db.SaveChangesAsync();

        var repository = new OrderRepository(db);

        var soundIds = (await repository.GetQuickLoansAsync(SystemType.Sound)).Select(o => o.Id).Order();
        Assert.Equal([601, 602], soundIds);

        var toolsIds = (await repository.GetQuickLoansAsync(SystemType.Tools)).Select(o => o.Id).Order();
        Assert.Equal([602, 603], toolsIds);
    }

    [Fact]
    public void ReturnStateRule_TreatsSerializedLineWithUnreturnedNoteAsStillActive()
    {
        var serializedLineWithStaleCounters = new OrderLoanedEquipment
        {
            Quantity = 1,
            ReturnedQuantity = 1,
            Notes =
            [
                new LoanedEquipmentNote
                {
                    Ordinal = 0,
                    Content = "ACC-42",
                    IsReturned = false
                }
            ]
        };

        var fullyReturnedSerializedLine = new OrderLoanedEquipment
        {
            Quantity = 1,
            ReturnedQuantity = 1,
            Notes =
            [
                new LoanedEquipmentNote
                {
                    Ordinal = 0,
                    Content = "ACC-99",
                    IsReturned = true
                }
            ]
        };

        Assert.True(OrderService.IsLoanedEquipmentActiveForReturnState(serializedLineWithStaleCounters));
        Assert.False(OrderService.AreAllLoanedEquipmentsReturnedForReturnState([serializedLineWithStaleCounters]));

        Assert.False(OrderService.IsLoanedEquipmentActiveForReturnState(fullyReturnedSerializedLine));
        Assert.True(OrderService.AreAllLoanedEquipmentsReturnedForReturnState([fullyReturnedSerializedLine]));
    }

    [Fact]
    public void ReturnStateRule_IgnoresOrderedQuantityShortfallWhenAllIssuedCodesReturned()
    {
        // Ordered 5, issued 3 codes, all 3 returned — must not count the 2 unordered codes as missing.
        var line = new OrderLoanedEquipment
        {
            Quantity = 5,
            ReturnedQuantity = 3,
            Notes =
            [
                new LoanedEquipmentNote { Ordinal = 0, Content = "A1", IsReturned = true },
                new LoanedEquipmentNote { Ordinal = 1, Content = "A2", IsReturned = true },
                new LoanedEquipmentNote { Ordinal = 2, Content = "A3", IsReturned = true },
                new LoanedEquipmentNote { Ordinal = 3, Content = null, IsReturned = false },
                new LoanedEquipmentNote { Ordinal = 4, Content = null, IsReturned = false }
            ]
        };

        Assert.Equal(3, OrderService.GetIssuedQuantity(line));
        Assert.False(OrderService.IsLoanedEquipmentActiveForReturnState(line));
        Assert.True(OrderService.AreAllLoanedEquipmentsReturnedForReturnState([line]));
    }

    [Fact]
    public void NormalizeQuickLoanReadModel_RecomputesLineAndOrderReturnStateFromNotes()
    {
        var order = new Order
        {
            IsReturnProcessed = true,
            LoanedEquipments =
            [
                new OrderLoanedEquipment
                {
                    Quantity = 1,
                    ReturnedQuantity = 1,
                    Notes =
                    [
                        new LoanedEquipmentNote
                        {
                            Ordinal = 0,
                            Content = "ACC-42",
                            IsReturned = false
                        }
                    ]
                }
            ]
        };

        OrderService.NormalizeQuickLoanReadModelForReturnState(order);

        var line = Assert.Single(order.LoanedEquipments);
        Assert.Equal(0, line.ReturnedQuantity);
        Assert.False(order.IsReturnProcessed);
    }

    [Fact]
    public async Task GetUnreturnedItemsAsync_MissingQuantityUsesIssuedCodes_NotOrderedQuantity()
    {
        await using var harness = await CreateSqliteHarnessAsync();
        var db = harness.Db;

        db.InventoryDefinitions.Add(new InventoryDefinition
        {
            Id = 101,
            DisplayName = "Adapter",
            IsActive = true
        });

        db.InventorySerialCodes.AddRange(
            new InventorySerialCode { InventoryDefinitionId = 101, SerialCode = "ACC-1" },
            new InventorySerialCode { InventoryDefinitionId = 101, SerialCode = "ACC-2" },
            new InventorySerialCode { InventoryDefinitionId = 101, SerialCode = "ACC-3" });

        // Ordered 5, issued 3 codes; 1 returned → missing must be 2 (issued), not 4 (ordered).
        db.Orders.Add(new Order
        {
            Id = 777,
            CustomerName = "Partial Return",
            Phone = "0507654321",
            SystemType = SystemType.Tools,
            IsCancelled = false,
            IsReturnProcessed = false,
            Shifts =
            [
                new OrderShift { OrderDate = new DateOnly(2026, 9, 7), TimeSlot = TimeSlot.Morning }
            ],
            LoanedEquipments =
            [
                new OrderLoanedEquipment
                {
                    Id = 7001,
                    InventoryDefinitionId = 101,
                    Quantity = 5,
                    ReturnedQuantity = 1,
                    ExpectedNoteCount = 5,
                    Notes =
                    [
                        new LoanedEquipmentNote { Ordinal = 0, Content = "ACC-1", IsReturned = true },
                        new LoanedEquipmentNote { Ordinal = 1, Content = "ACC-2", IsReturned = false },
                        new LoanedEquipmentNote { Ordinal = 2, Content = "ACC-3", IsReturned = false },
                        new LoanedEquipmentNote { Ordinal = 3, Content = null, IsReturned = false },
                        new LoanedEquipmentNote { Ordinal = 4, Content = null, IsReturned = false }
                    ]
                }
            ]
        });

        await db.SaveChangesAsync();

        var repository = new OrderRepository(db);
        var items = await repository.GetUnreturnedItemsAsync();

        var match = Assert.Single(items);
        Assert.Equal(777, match.OrderId);
        Assert.Equal(7001, match.LoanedEquipmentId);
        Assert.Equal(3, match.QuantityLoaned);
        Assert.Equal(2, match.MissingQuantity);
        Assert.Contains("ACC-2", match.MissingSerialCodes);
        Assert.Contains("ACC-3", match.MissingSerialCodes);
        Assert.DoesNotContain("ACC-1", match.MissingSerialCodes);
    }

    private static Order CreateOutstandingLoan(
        int id,
        SystemType systemType,
        string? equipmentDefinitionId = null)
    {
        var order = new Order
        {
            Id = id,
            CustomerName = $"Borrower {id}",
            Phone = "0501111111",
            SystemType = systemType,
            Shifts =
            [
                new OrderShift { OrderDate = new DateOnly(2026, 10, 12), TimeSlot = TimeSlot.Morning }
            ],
            LoanedEquipments =
            [
                new OrderLoanedEquipment
                {
                    Id = id * 10,
                    IsCustomItem = true,
                    CustomItemName = "Cable",
                    Quantity = 1,
                    ReturnedQuantity = 0
                }
            ]
        };

        if (equipmentDefinitionId != null)
        {
            order.Equipments.Add(new OrderEquipment { EquipmentDefinitionId = equipmentDefinitionId });
        }

        return order;
    }

    private static async Task<SqliteHarness> CreateSqliteHarnessAsync()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseSqlite(connection)
            .Options;

        var db = new AppDbContext(options);
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
