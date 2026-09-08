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
    public async Task GetUnreturnedItemsAsync_IncludesActiveSerializedLine_WithoutPriorReturnMarkers()
    {
        await using var harness = await CreateSqliteHarnessAsync();
        var db = harness.Db;

        db.InventoryDefinitions.Add(new InventoryDefinition
        {
            Id = 101,
            DisplayName = "Adapter",
            IsActive = true
        });

        db.InventorySerialCodes.Add(new InventorySerialCode
        {
            InventoryDefinitionId = 101,
            SerialCode = "ACC-42"
        });

        db.Orders.Add(new Order
        {
            Id = 777,
            CustomerName = "Active Notes Only",
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
                    Quantity = 1,
                    ReturnedQuantity = 0,
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
        var items = await repository.GetUnreturnedItemsAsync();

        var match = Assert.Single(items);
        Assert.Equal(777, match.OrderId);
        Assert.Equal(7001, match.LoanedEquipmentId);
        Assert.Equal(1, match.MissingQuantity);
        Assert.Contains("ACC-42", match.MissingSerialCodes);
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
