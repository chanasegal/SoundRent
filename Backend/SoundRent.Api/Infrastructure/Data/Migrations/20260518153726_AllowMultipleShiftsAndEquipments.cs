using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AllowMultipleShiftsAndEquipments : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "OrderEquipments",
                columns: table => new
                {
                    OrderId = table.Column<int>(type: "integer", nullable: false),
                    EquipmentDefinitionId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderEquipments", x => new { x.OrderId, x.EquipmentDefinitionId });
                    table.ForeignKey(
                        name: "FK_OrderEquipments_EquipmentDefinitions_EquipmentDefinitionId",
                        column: x => x.EquipmentDefinitionId,
                        principalTable: "EquipmentDefinitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_OrderEquipments_Orders_OrderId",
                        column: x => x.OrderId,
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "OrderShifts",
                columns: table => new
                {
                    OrderId = table.Column<int>(type: "integer", nullable: false),
                    OrderDate = table.Column<DateOnly>(type: "date", nullable: false),
                    TimeSlot = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_OrderShifts", x => new { x.OrderId, x.OrderDate, x.TimeSlot });
                    table.ForeignKey(
                        name: "FK_OrderShifts_Orders_OrderId",
                        column: x => x.OrderId,
                        principalTable: "Orders",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_OrderEquipments_EquipmentDefinitionId",
                table: "OrderEquipments",
                column: "EquipmentDefinitionId");

            migrationBuilder.CreateIndex(
                name: "IX_OrderShifts_Date_TimeSlot",
                table: "OrderShifts",
                columns: new[] { "OrderDate", "TimeSlot" });

            migrationBuilder.Sql("""
                INSERT INTO "OrderEquipments" ("OrderId", "EquipmentDefinitionId")
                SELECT o."Id", o."EquipmentType"
                FROM "Orders" o
                WHERE o."EquipmentType" <> ''
                  AND EXISTS (
                      SELECT 1
                      FROM "EquipmentDefinitions" e
                      WHERE e."Id" = o."EquipmentType"
                  )
                ON CONFLICT DO NOTHING;
                """);

            migrationBuilder.Sql("""
                INSERT INTO "OrderShifts" ("OrderId", "OrderDate", "TimeSlot")
                SELECT o."Id", o."OrderDate", o."TimeSlot"
                FROM "Orders" o
                ON CONFLICT DO NOTHING;
                """);

            migrationBuilder.DropIndex(
                name: "IX_Orders_Equipment_Date_TimeSlot",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "EquipmentType",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "OrderDate",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "TimeSlot",
                table: "Orders");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "EquipmentType",
                table: "Orders",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateOnly>(
                name: "OrderDate",
                table: "Orders",
                type: "date",
                nullable: false,
                defaultValue: new DateOnly(1, 1, 1));

            migrationBuilder.AddColumn<int>(
                name: "TimeSlot",
                table: "Orders",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.Sql("""
                UPDATE "Orders" o
                SET "EquipmentType" = COALESCE((
                    SELECT oe."EquipmentDefinitionId"
                    FROM "OrderEquipments" oe
                    WHERE oe."OrderId" = o."Id"
                    ORDER BY oe."EquipmentDefinitionId"
                    LIMIT 1
                ), '');
                """);

            migrationBuilder.Sql("""
                UPDATE "Orders" o
                SET
                    "OrderDate" = COALESCE((
                        SELECT os."OrderDate"
                        FROM "OrderShifts" os
                        WHERE os."OrderId" = o."Id"
                        ORDER BY os."OrderDate", os."TimeSlot"
                        LIMIT 1
                    ), DATE '0001-01-01'),
                    "TimeSlot" = COALESCE((
                        SELECT os."TimeSlot"
                        FROM "OrderShifts" os
                        WHERE os."OrderId" = o."Id"
                        ORDER BY os."OrderDate", os."TimeSlot"
                        LIMIT 1
                    ), 0);
                """);

            migrationBuilder.DropTable(
                name: "OrderEquipments");

            migrationBuilder.DropTable(
                name: "OrderShifts");

            migrationBuilder.CreateIndex(
                name: "IX_Orders_Equipment_Date_TimeSlot",
                table: "Orders",
                columns: new[] { "EquipmentType", "OrderDate", "TimeSlot" });
        }
    }
}
