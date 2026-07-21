using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using SoundRent.Api.Infrastructure.Data;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDbContext))]
    [Migration("20260722010000_EquipmentDefaultAccessoryInventoryDefinition")]
    public class EquipmentDefaultAccessoryInventoryDefinition : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_EquipmentDefaultAccessories_ParentUnit_Type_Code",
                table: "EquipmentDefaultAccessories");

            migrationBuilder.AlterColumn<int>(
                name: "AccessoryEquipmentType",
                table: "EquipmentDefaultAccessories",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AddColumn<int>(
                name: "InventoryDefinitionId",
                table: "EquipmentDefaultAccessories",
                type: "integer",
                nullable: true);

            // Backfill catalog id from linked system type where possible.
            migrationBuilder.Sql("""
                UPDATE "EquipmentDefaultAccessories" AS d
                SET "InventoryDefinitionId" = i."Id"
                FROM "InventoryDefinitions" AS i
                WHERE d."InventoryDefinitionId" IS NULL
                  AND d."AccessoryEquipmentType" IS NOT NULL
                  AND i."LinkedEquipmentType" = d."AccessoryEquipmentType";
                """);

            migrationBuilder.CreateIndex(
                name: "IX_EquipmentDefaultAccessories_ParentUnit_Def_Code",
                table: "EquipmentDefaultAccessories",
                columns: new[]
                {
                    "ParentEquipmentType",
                    "ParentSerialCode",
                    "InventoryDefinitionId",
                    "AccessorySerialCode"
                },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_EquipmentDefaultAccessories_InventoryDefinitionId",
                table: "EquipmentDefaultAccessories",
                column: "InventoryDefinitionId");

            migrationBuilder.AddForeignKey(
                name: "FK_EquipmentDefaultAccessories_InventoryDefinitions_InventoryDefinitionId",
                table: "EquipmentDefaultAccessories",
                column: "InventoryDefinitionId",
                principalTable: "InventoryDefinitions",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_EquipmentDefaultAccessories_InventoryDefinitions_InventoryDefinitionId",
                table: "EquipmentDefaultAccessories");

            migrationBuilder.DropIndex(
                name: "IX_EquipmentDefaultAccessories_ParentUnit_Def_Code",
                table: "EquipmentDefaultAccessories");

            migrationBuilder.DropIndex(
                name: "IX_EquipmentDefaultAccessories_InventoryDefinitionId",
                table: "EquipmentDefaultAccessories");

            migrationBuilder.DropColumn(
                name: "InventoryDefinitionId",
                table: "EquipmentDefaultAccessories");

            migrationBuilder.Sql("""
                DELETE FROM "EquipmentDefaultAccessories"
                WHERE "AccessoryEquipmentType" IS NULL;
                """);

            migrationBuilder.AlterColumn<int>(
                name: "AccessoryEquipmentType",
                table: "EquipmentDefaultAccessories",
                type: "integer",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_EquipmentDefaultAccessories_ParentUnit_Type_Code",
                table: "EquipmentDefaultAccessories",
                columns: new[]
                {
                    "ParentEquipmentType",
                    "ParentSerialCode",
                    "AccessoryEquipmentType",
                    "AccessorySerialCode"
                },
                unique: true);
        }
    }
}
