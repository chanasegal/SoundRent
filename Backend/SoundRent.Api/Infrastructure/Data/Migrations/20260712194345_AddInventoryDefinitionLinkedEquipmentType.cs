using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddInventoryDefinitionLinkedEquipmentType : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
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
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_InventoryDefinitions_LinkedEquipmentType",
                table: "InventoryDefinitions");

            migrationBuilder.DropColumn(
                name: "LinkedEquipmentType",
                table: "InventoryDefinitions");
        }
    }
}
