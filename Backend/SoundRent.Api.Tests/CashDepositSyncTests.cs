using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Services;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Domain.Enums;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Tests;

public class CashDepositSyncTests : IAsyncLifetime
{
    private SqliteConnection _connection = null!;
    private AppDbContext _db = null!;
    private CashDepositService _deposits = null!;
    private BookLoanService _loans = null!;

    public async Task InitializeAsync()
    {
        _connection = new SqliteConnection("Data Source=:memory:");
        await _connection.OpenAsync();
        _db = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseSqlite(_connection).Options);
        await _db.Database.EnsureCreatedAsync();

        _db.Books.Add(new Book
        {
            Id = 1,
            Title = "Book",
            Copies = [new BookCopy { CopyNumber = "1" }]
        });
        await _db.SaveChangesAsync();

        _deposits = new CashDepositService(_db);
        _loans = new BookLoanService(_db, _deposits);
    }

    public async Task DisposeAsync()
    {
        await _db.DisposeAsync();
        await _connection.DisposeAsync();
    }

    [Fact]
    public async Task SavingLoanWithCash_CreatesSingleOpenDeposit_AndUpdatesItOnEdit()
    {
        var created = await _loans.CreateAsync(Request(cash: 200m));

        var open = await _deposits.GetAsync(CashDepositStatus.Open, null);
        var deposit = Assert.Single(open);
        Assert.Equal(200m, deposit.Amount);
        Assert.Equal(created.Id, deposit.BookLoanId);
        Assert.Equal(SystemType.Library, deposit.SourceModule);
        Assert.Equal("0501234567", deposit.Phone);

        await _loans.UpdateAsync(created.Id, Request(cash: 350m));

        deposit = Assert.Single(await _deposits.GetAsync(null, null));
        Assert.Equal(350m, deposit.Amount);
    }

    [Fact]
    public async Task ClearingCashBeforeReturn_RemovesOpenDeposit()
    {
        var created = await _loans.CreateAsync(Request(cash: 100m));

        await _loans.UpdateAsync(created.Id, Request(cash: null));

        Assert.Empty(await _deposits.GetAsync(null, null));
    }

    [Fact]
    public async Task MarkReturned_StampsReturnTime_AndResaveDoesNotReopen()
    {
        var created = await _loans.CreateAsync(Request(cash: 100m));
        var deposit = Assert.Single(await _deposits.GetAsync(CashDepositStatus.Open, null));

        var before = DateTime.UtcNow;
        var returned = await _deposits.MarkReturnedAsync(deposit.Id);
        Assert.Equal(CashDepositStatus.Returned, returned.Status);
        Assert.True(returned.ReturnedAt >= before.AddSeconds(-1));

        await _loans.UpdateAsync(created.Id, Request(cash: 100m));

        Assert.Empty(await _deposits.GetAsync(CashDepositStatus.Open, null));
        Assert.Single(await _deposits.GetAsync(CashDepositStatus.Returned, null));
    }

    [Fact]
    public void OrderWithCashTypeButNoAmount_IsRejected()
    {
        var dto = new OrderCreateUpdateDto { DepositType = DepositType.Cash, CashDepositAmount = null };

        Assert.Throws<SoundRent.Api.Application.Exceptions.ValidationException>(
            () => CashDepositService.EnsureOrderCashDepositAmount(dto, existing: null));
        Assert.Throws<SoundRent.Api.Application.Exceptions.ValidationException>(
            () => CashDepositService.EnsureOrderCashDepositAmount(
                dto,
                new Order { DepositType = DepositType.Check }));
    }

    [Fact]
    public void LegacyCashOrderWithoutAmount_CanStillBeEdited()
    {
        var dto = new OrderCreateUpdateDto { DepositType = DepositType.Cash, CashDepositAmount = null };
        var legacy = new Order { DepositType = DepositType.Cash, CashDepositAmount = null };

        CashDepositService.EnsureOrderCashDepositAmount(dto, legacy);
        CashDepositService.EnsureOrderCashDepositAmount(
            new OrderCreateUpdateDto { DepositType = DepositType.Cash, CashDepositAmount = 150m },
            existing: null);
    }

    private static BookLoanCreateDto Request(decimal? cash) => new()
    {
        ClientName = "Reader",
        Phone = "0501234567",
        HebrewLentDisplay = "test",
        CashDepositAmount = cash,
        Items = [new BookLoanItemCreateDto { BookId = 1, CopyNumber = "1" }]
    };
}
