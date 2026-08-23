using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using SoundRent.Api.Infrastructure.Data;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations;

/// <summary>
/// Consolidates AccessorySerialInventory into InventorySerialCodes and links order lines to catalog rows by id.
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260823120000_UnifyInventorySerialStorage")]
public partial class UnifyInventorySerialStorage : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // Copy linked-type serials from AccessorySerialInventory into InventorySerialCodes.
        migrationBuilder.Sql("""
            INSERT INTO "InventorySerialCodes" ("InventoryDefinitionId", "SerialCode", "PhysicalStatus")
            SELECT d."Id", ai."SerialCode", ai."PhysicalStatus"
            FROM "AccessorySerialInventory" ai
            INNER JOIN "InventoryDefinitions" d ON d."LinkedEquipmentType" = ai."EquipmentType"
            WHERE NOT EXISTS (
                SELECT 1 FROM "InventorySerialCodes" isc
                WHERE isc."InventoryDefinitionId" = d."Id"
                  AND isc."SerialCode" = ai."SerialCode"
            );
            """);

        migrationBuilder.AddColumn<int>(
            name: "InventoryDefinitionId",
            table: "OrderLoanedEquipments",
            type: "integer",
            nullable: true);

        migrationBuilder.CreateIndex(
            name: "IX_OrderLoanedEquipments_InventoryDefinitionId",
            table: "OrderLoanedEquipments",
            column: "InventoryDefinitionId");

        migrationBuilder.AddForeignKey(
            name: "FK_OrderLoanedEquipments_InventoryDefinitions_InventoryDefinitionId",
            table: "OrderLoanedEquipments",
            column: "InventoryDefinitionId",
            principalTable: "InventoryDefinitions",
            principalColumn: "Id",
            onDelete: ReferentialAction.SetNull);

        // Backfill catalog id from linked enum type.
        migrationBuilder.Sql("""
            UPDATE "OrderLoanedEquipments" le
            SET "InventoryDefinitionId" = d."Id"
            FROM "InventoryDefinitions" d
            WHERE le."InventoryDefinitionId" IS NULL
              AND le."IsCustomItem" = false
              AND le."LoanedEquipmentType" IS NOT NULL
              AND d."LinkedEquipmentType" = le."LoanedEquipmentType"
              AND d."IsActive" = true;
            """);

        // Backfill catalog id from custom line name matching an active catalog row.
        migrationBuilder.Sql("""
            UPDATE "OrderLoanedEquipments" le
            SET "InventoryDefinitionId" = d."Id"
            FROM "InventoryDefinitions" d
            WHERE le."InventoryDefinitionId" IS NULL
              AND le."IsCustomItem" = true
              AND le."CustomItemName" IS NOT NULL
              AND lower(trim(le."CustomItemName")) = lower(trim(d."DisplayName"))
              AND d."IsActive" = true;
            """);

        migrationBuilder.DropTable(
            name: "AccessorySerialInventory");

        migrationBuilder.DropIndex(
            name: "IX_InventoryDefinitions_LinkedEquipmentType",
            table: "InventoryDefinitions");

        migrationBuilder.DropColumn(
            name: "LinkedEquipmentType",
            table: "InventoryDefinitions");
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<int>(
            name: "LinkedEquipmentType",
            table: "InventoryDefinitions",
            type: "integer",
            nullable: true);

        migrationBuilder.CreateIndex(
            name: "IX_InventoryDefinitions_LinkedEquipmentType",
            table: "InventoryDefinitions",
            column: "LinkedEquipmentType",
            unique: true,
            filter: "\"LinkedEquipmentType\" IS NOT NULL");

        migrationBuilder.CreateTable(
            name: "AccessorySerialInventory",
            columns: table => new
            {
                Id = table.Column<int>(type: "integer", nullable: false),
                EquipmentType = table.Column<int>(type: "integer", nullable: false),
                SerialCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                PhysicalStatus = table.Column<int>(type: "integer", nullable: false, defaultValue: 0)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_AccessorySerialInventory", x => x.Id);
            });

        migrationBuilder.DropForeignKey(
            name: "FK_OrderLoanedEquipments_InventoryDefinitions_InventoryDefinitionId",
            table: "OrderLoanedEquipments");

        migrationBuilder.DropIndex(
            name: "IX_OrderLoanedEquipments_InventoryDefinitionId",
            table: "OrderLoanedEquipments");

        migrationBuilder.DropColumn(
            name: "InventoryDefinitionId",
            table: "OrderLoanedEquipments");
    }
}
