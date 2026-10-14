using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using SoundRent.Api.Application.DTOs;
using SoundRent.Api.Application.Mapping;
using SoundRent.Api.Application.Services;
using SoundRent.Api.Domain.Entities;
using SoundRent.Api.Infrastructure.Data;

namespace SoundRent.Api.Tests;

public class LoanItemAddedAtTests
{
    [Fact]
    public async Task BookLoanUpdate_StampsOnlyNewlyAddedCopies()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        await using var _ = connection;
        await using var db = new AppDbContext(
            new DbContextOptionsBuilder<AppDbContext>().UseSqlite(connection).Options);
        await db.Database.EnsureCreatedAsync();

        db.Books.Add(new Book
        {
            Id = 1,
            Title = "Book",
            Copies = [new BookCopy { CopyNumber = "1" }, new BookCopy { CopyNumber = "2" }]
        });
        await db.SaveChangesAsync();

        var service = new BookLoanService(db);
        var created = await service.CreateAsync(BookLoanRequest("1"));

        var originalAddedAt = DateTime.UtcNow.AddHours(-3);
        var loan = await db.BookLoans.Include(l => l.Items).SingleAsync(l => l.Id == created.Id);
        loan.LentAt = originalAddedAt;
        loan.Items.Single().AddedAt = originalAddedAt;
        await db.SaveChangesAsync();
        db.ChangeTracker.Clear();

        var beforeUpdate = DateTime.UtcNow;
        var updated = await service.UpdateAsync(created.Id, BookLoanRequest("1", "2"));

        var original = updated.Items.Single(i => i.CopyNumber == "1");
        var added = updated.Items.Single(i => i.CopyNumber == "2");
        Assert.Equal(originalAddedAt, original.AddedAt, TimeSpan.FromMilliseconds(1));
        Assert.True(added.AddedAt >= beforeUpdate.AddMilliseconds(-1));
    }

    [Fact]
    public void SyncEquipments_PreservesExistingAddedAt_AndStampsNewEquipment()
    {
        var originalAddedAt = DateTime.UtcNow.AddDays(-1);
        var order = new Order
        {
            Equipments =
            [
                new OrderEquipment { EquipmentDefinitionId = "A", AddedAt = originalAddedAt },
                new OrderEquipment { EquipmentDefinitionId = "B", AddedAt = originalAddedAt }
            ]
        };

        var beforeSync = DateTime.UtcNow;
        OrderMapper.SyncEquipments(order, ["A", "C"]);

        Assert.Equal(["A", "C"], order.Equipments.Select(e => e.EquipmentDefinitionId).Order());
        Assert.Equal(originalAddedAt, order.Equipments.Single(e => e.EquipmentDefinitionId == "A").AddedAt);
        Assert.True(order.Equipments.Single(e => e.EquipmentDefinitionId == "C").AddedAt >= beforeSync);
    }

    [Fact]
    public void OrderCreate_StampsLinesWithOrderCreationTime()
    {
        var order = OrderMapper.ToEntity(new OrderCreateUpdateDto
        {
            Phone = "0501234567",
            EquipmentDefinitionIds = ["A"],
            LoanedEquipments = [new OrderLoanedEquipmentDto { IsCustomItem = true, CustomItemName = "Cable", Quantity = 1 }]
        });

        Assert.Equal(order.CreatedAt, order.Equipments.Single().AddedAt);
        Assert.Equal(order.CreatedAt, order.LoanedEquipments.Single().AddedAt);
    }

    private static BookLoanCreateDto BookLoanRequest(params string[] copyNumbers) => new()
    {
        ClientName = "Reader",
        Phone = "0501234567",
        HebrewLentDisplay = "test",
        Items = copyNumbers.Select(c => new BookLoanItemCreateDto { BookId = 1, CopyNumber = c }).ToList()
    };
}
