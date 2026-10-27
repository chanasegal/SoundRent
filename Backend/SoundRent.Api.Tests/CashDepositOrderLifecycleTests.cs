using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Services;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Tests;

/// <summary>
/// Deposit Open/Returned must stay independent of order cancel, soft-delete, and return-processed.
/// </summary>
public class CashDepositOrderLifecycleTests : IAsyncLifetime
{
    private SqliteConnection _connection = null!;
    private AppDbContext _db = null!;
    private CashDepositService _deposits = null!;

    public async Task InitializeAsync()
    {
        _connection = new SqliteConnection("Data Source=:memory:");
        await _connection.OpenAsync();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_connection).Options);
        await _db.Database.EnsureCreatedAsync();
        _deposits = new CashDepositService(_db);
    }

    public async Task DisposeAsync()
    {
        await _db.DisposeAsync();
        await _connection.DisposeAsync();
    }

    [Fact]
    public async Task CancelOrder_LeavesOpenDepositActive()
    {
        var order = await SeedOrderWithCashDepositAsync(150m);

        order.IsCancelled = true;
        await _db.SaveChangesAsync();
        await _deposits.SyncForOrderAsync(order);

        var open = await _deposits.GetAsync(CashDepositStatus.Open, order.Phone);
        var deposit = Assert.Single(open);
        Assert.Equal(order.Id, deposit.OrderId);
        Assert.Equal(150m, deposit.Amount);
        Assert.Equal(CashDepositStatus.Open, deposit.Status);
    }

    [Fact]
    public async Task SoftDeleteOrder_KeepsDepositLinkedAndOpen_AndSearchableByPhone()
    {
        var order = await SeedOrderWithCashDepositAsync(200m);
        var phone = order.Phone;

        order.IsDeleted = true;
        order.DeletedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        // Soft-deleted order remains in the table (for deposit FK) but is excluded from live queries.
        Assert.Null(await _db.Orders.FirstOrDefaultAsync(o => o.Id == order.Id && !o.IsDeleted));
        Assert.NotNull(await _db.Orders.FirstOrDefaultAsync(o => o.Id == order.Id && o.IsDeleted));

        var open = await _deposits.GetAsync(CashDepositStatus.Open, phone);
        var deposit = Assert.Single(open);
        Assert.Equal(order.Id, deposit.OrderId);
        Assert.Equal(CashDepositStatus.Open, deposit.Status);

        // Explicit return still works against a soft-deleted order.
        var result = await _deposits.SetReturnedBySourceAsync(new SetDepositReturnedDto
        {
            OrderId = order.Id,
            Returned = true
        });
        Assert.True(result.DepositReturned);
        Assert.Empty(await _deposits.GetAsync(CashDepositStatus.Open, phone));
        Assert.Single(await _deposits.GetAsync(CashDepositStatus.Returned, phone));
    }

    [Fact]
    public async Task FullReturnProcessed_DoesNotAutoReturnDeposit()
    {
        var order = await SeedOrderWithCashDepositAsync(80m);

        order.IsReturnProcessed = true;
        await _db.SaveChangesAsync();
        await _deposits.SyncForOrderAsync(order);

        var deposit = Assert.Single(await _deposits.GetAsync(CashDepositStatus.Open, null));
        Assert.Equal(order.Id, deposit.OrderId);
        Assert.False(order.DepositReturned);
    }

    [Fact]
    public async Task CancelledOrder_ClearingCashAmount_DoesNotRemoveOpenDeposit()
    {
        var order = await SeedOrderWithCashDepositAsync(90m);

        order.IsCancelled = true;
        order.DepositType = null;
        order.CashDepositAmount = null;
        await _db.SaveChangesAsync();
        await _deposits.SyncForOrderAsync(order);

        Assert.Single(await _deposits.GetAsync(CashDepositStatus.Open, order.Phone));
    }

    private async Task<Order> SeedOrderWithCashDepositAsync(decimal amount)
    {
        var order = new Order
        {
            CustomerName = "Test Customer",
            Phone = "0501234567",
            Address = "Tel Aviv",
            DepositType = DepositType.Cash,
            CashDepositAmount = amount,
            DepositReturned = false,
            SystemType = SystemType.Sound,
            Shifts =
            [
                new OrderShift
                {
                    OrderDate = DateOnly.FromDateTime(DateTime.UtcNow),
                    TimeSlot = TimeSlot.Morning
                }
            ]
        };
        _db.Orders.Add(order);
        await _db.SaveChangesAsync();
        await _deposits.SyncForOrderAsync(order);
        return order;
    }
}
