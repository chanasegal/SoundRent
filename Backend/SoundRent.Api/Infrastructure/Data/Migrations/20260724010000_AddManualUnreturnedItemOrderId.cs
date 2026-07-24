using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using SoundRent.Api.Infrastructure.Data;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDbContext))]
    [Migration("20260724010000_AddManualUnreturnedItemOrderId")]
    public class AddManualUnreturnedItemOrderId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "OrderId",
                table: "ManualUnreturnedItems",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ManualUnreturnedItems_OrderId",
                table: "ManualUnreturnedItems",
                column: "OrderId");

            migrationBuilder.AddForeignKey(
                name: "FK_ManualUnreturnedItems_Orders_OrderId",
                table: "ManualUnreturnedItems",
                column: "OrderId",
                principalTable: "Orders",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ManualUnreturnedItems_Orders_OrderId",
                table: "ManualUnreturnedItems");

            migrationBuilder.DropIndex(
                name: "IX_ManualUnreturnedItems_OrderId",
                table: "ManualUnreturnedItems");

            migrationBuilder.DropColumn(
                name: "OrderId",
                table: "ManualUnreturnedItems");
        }
    }
}
