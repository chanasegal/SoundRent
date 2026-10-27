using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using SoundRent.Api.Infrastructure.Data;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDbContext))]
    [Migration("20261025180000_DecoupleCashDepositsFromOrderLifecycle")]
    public class DecoupleCashDepositsFromOrderLifecycle : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsDeleted",
                table: "Orders",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                table: "Orders",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Orders_IsDeleted",
                table: "Orders",
                column: "IsDeleted");

            // Orphan ledger rows from prior hard-deletes would block the FK — clear the broken link
            // but keep the deposit row (status stays Open/Returned independently).
            migrationBuilder.Sql("""
                UPDATE "CashDeposits" d
                SET "OrderId" = NULL
                WHERE d."OrderId" IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM "Orders" o WHERE o."Id" = d."OrderId");
                """);

            migrationBuilder.AddForeignKey(
                name: "FK_CashDeposits_Orders_OrderId",
                table: "CashDeposits",
                column: "OrderId",
                principalTable: "Orders",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_CashDeposits_Orders_OrderId",
                table: "CashDeposits");

            migrationBuilder.DropIndex(
                name: "IX_Orders_IsDeleted",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "IsDeleted",
                table: "Orders");
        }
    }
}
