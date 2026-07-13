using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddSystemType : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "SystemType",
                table: "WaitlistEntries",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SystemType",
                table: "Orders",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SystemType",
                table: "EquipmentDefinitions",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SystemType",
                table: "BlockedDates",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_WaitlistEntries_SystemType",
                table: "WaitlistEntries",
                column: "SystemType");

            migrationBuilder.CreateIndex(
                name: "IX_Orders_SystemType",
                table: "Orders",
                column: "SystemType");

            migrationBuilder.CreateIndex(
                name: "IX_EquipmentDefinitions_SystemType",
                table: "EquipmentDefinitions",
                column: "SystemType");

            migrationBuilder.CreateIndex(
                name: "IX_BlockedDates_SystemType",
                table: "BlockedDates",
                column: "SystemType");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_WaitlistEntries_SystemType",
                table: "WaitlistEntries");

            migrationBuilder.DropIndex(
                name: "IX_Orders_SystemType",
                table: "Orders");

            migrationBuilder.DropIndex(
                name: "IX_EquipmentDefinitions_SystemType",
                table: "EquipmentDefinitions");

            migrationBuilder.DropIndex(
                name: "IX_BlockedDates_SystemType",
                table: "BlockedDates");

            migrationBuilder.DropColumn(
                name: "SystemType",
                table: "WaitlistEntries");

            migrationBuilder.DropColumn(
                name: "SystemType",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "SystemType",
                table: "EquipmentDefinitions");

            migrationBuilder.DropColumn(
                name: "SystemType",
                table: "BlockedDates");
        }
    }
}
