using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using SoundRent.Api.Infrastructure.Data;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDbContext))]
    [Migration("20260721183000_AddInventoryDefinitionQuantity")]
    public class AddInventoryDefinitionQuantity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Quantity",
                table: "InventoryDefinitions",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // Seed existing rows from current serial counts (linked types use AccessorySerialInventory).
            migrationBuilder.Sql(
                """
                UPDATE "InventoryDefinitions" AS d
                SET "Quantity" = COALESCE((
                    SELECT COUNT(*)::int
                    FROM "InventorySerialCodes" AS s
                    WHERE s."InventoryDefinitionId" = d."Id"
                ), 0)
                WHERE d."LinkedEquipmentType" IS NULL;

                UPDATE "InventoryDefinitions" AS d
                SET "Quantity" = COALESCE((
                    SELECT COUNT(*)::int
                    FROM "AccessorySerialInventory" AS a
                    WHERE a."EquipmentType" = d."LinkedEquipmentType"
                ), 0)
                WHERE d."LinkedEquipmentType" IS NOT NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Quantity",
                table: "InventoryDefinitions");
        }
    }
}
