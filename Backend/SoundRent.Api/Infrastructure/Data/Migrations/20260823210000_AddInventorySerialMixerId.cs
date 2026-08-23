using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using SoundRent.Api.Infrastructure.Data;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations;

/// <summary>
/// Adds MixerId on InventorySerialCodes so accessories can be attached to a specific mixer unit.
/// Backfills from EquipmentDefaultAccessories for Mixer parents.
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260823210000_AddInventorySerialMixerId")]
public partial class AddInventorySerialMixerId : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<int>(
            name: "MixerId",
            table: "InventorySerialCodes",
            type: "integer",
            nullable: true);

        migrationBuilder.CreateIndex(
            name: "IX_InventorySerialCodes_MixerId",
            table: "InventorySerialCodes",
            column: "MixerId");

        migrationBuilder.AddForeignKey(
            name: "FK_InventorySerialCodes_InventorySerialCodes_MixerId",
            table: "InventorySerialCodes",
            column: "MixerId",
            principalTable: "InventorySerialCodes",
            principalColumn: "Id",
            onDelete: ReferentialAction.SetNull);

        // Backfill attachment from existing mixer default-accessory kit rows.
        // ParentEquipmentType = 1 is LoanedEquipmentType.Mixer ("מיקסר").
        migrationBuilder.Sql("""
            UPDATE "InventorySerialCodes" accessory
            SET "MixerId" = mixer."Id"
            FROM "EquipmentDefaultAccessories" eda
            INNER JOIN "InventoryDefinitions" mixer_def
                ON mixer_def."IsActive" = true
               AND lower(trim(mixer_def."DisplayName")) = lower(trim('מיקסר'))
            INNER JOIN "InventorySerialCodes" mixer
                ON mixer."InventoryDefinitionId" = mixer_def."Id"
               AND mixer."SerialCode" = eda."ParentSerialCode"
            WHERE eda."ParentEquipmentType" = 1
              AND eda."InventoryDefinitionId" IS NOT NULL
              AND accessory."InventoryDefinitionId" = eda."InventoryDefinitionId"
              AND accessory."SerialCode" = eda."AccessorySerialCode"
              AND accessory."MixerId" IS NULL
              AND accessory."Id" <> mixer."Id";
            """);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropForeignKey(
            name: "FK_InventorySerialCodes_InventorySerialCodes_MixerId",
            table: "InventorySerialCodes");

        migrationBuilder.DropIndex(
            name: "IX_InventorySerialCodes_MixerId",
            table: "InventorySerialCodes");

        migrationBuilder.DropColumn(
            name: "MixerId",
            table: "InventorySerialCodes");
    }
}
