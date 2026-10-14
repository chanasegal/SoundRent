using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLoanItemAddedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "AddedAt",
                table: "ToolLoanItems",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<DateTime>(
                name: "AddedAt",
                table: "OrderLoanedEquipments",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<DateTime>(
                name: "AddedAt",
                table: "OrderEquipments",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<DateTime>(
                name: "AddedAt",
                table: "BookLoanItems",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            // Existing rows predate per-item tracking: inherit the parent's original timestamp.
            migrationBuilder.Sql("""
                UPDATE "BookLoanItems" AS i
                SET "AddedAt" = l."LentAt"
                FROM "BookLoans" AS l
                WHERE i."BookLoanId" = l."Id";
                """);

            migrationBuilder.Sql("""
                UPDATE "ToolLoanItems" AS i
                SET "AddedAt" = l."LentAt"
                FROM "ToolLoans" AS l
                WHERE i."ToolLoanId" = l."Id";
                """);

            migrationBuilder.Sql("""
                UPDATE "OrderLoanedEquipments" AS le
                SET "AddedAt" = o."CreatedAt"
                FROM "Orders" AS o
                WHERE le."OrderId" = o."Id";
                """);

            migrationBuilder.Sql("""
                UPDATE "OrderEquipments" AS oe
                SET "AddedAt" = o."CreatedAt"
                FROM "Orders" AS o
                WHERE oe."OrderId" = o."Id";
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "AddedAt",
                table: "ToolLoanItems");

            migrationBuilder.DropColumn(
                name: "AddedAt",
                table: "OrderLoanedEquipments");

            migrationBuilder.DropColumn(
                name: "AddedAt",
                table: "OrderEquipments");

            migrationBuilder.DropColumn(
                name: "AddedAt",
                table: "BookLoanItems");
        }
    }
}
