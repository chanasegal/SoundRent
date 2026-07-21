using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using SoundRent.Api.Infrastructure.Data;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDbContext))]
    [Migration("20260721030000_EquipmentDefaultAccessoryParentSerial")]
    public class EquipmentDefaultAccessoryParentSerial : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_EquipmentDefaultAccessories_Parent_Type_Code",
                table: "EquipmentDefaultAccessories");

            migrationBuilder.DropIndex(
                name: "IX_EquipmentDefaultAccessories_Parent",
                table: "EquipmentDefaultAccessories");

            // Type-level rows (no unit) cannot be migrated meaningfully — clear them.
            migrationBuilder.Sql("""DELETE FROM "EquipmentDefaultAccessories";""");

            migrationBuilder.AddColumn<string>(
                name: "ParentSerialCode",
                table: "EquipmentDefaultAccessories",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateIndex(
                name: "IX_EquipmentDefaultAccessories_ParentUnit",
                table: "EquipmentDefaultAccessories",
                columns: new[] { "ParentEquipmentType", "ParentSerialCode" });

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

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_EquipmentDefaultAccessories_ParentUnit_Type_Code",
                table: "EquipmentDefaultAccessories");

            migrationBuilder.DropIndex(
                name: "IX_EquipmentDefaultAccessories_ParentUnit",
                table: "EquipmentDefaultAccessories");

            migrationBuilder.DropColumn(
                name: "ParentSerialCode",
                table: "EquipmentDefaultAccessories");

            migrationBuilder.CreateIndex(
                name: "IX_EquipmentDefaultAccessories_Parent",
                table: "EquipmentDefaultAccessories",
                column: "ParentEquipmentType");

            migrationBuilder.CreateIndex(
                name: "IX_EquipmentDefaultAccessories_Parent_Type_Code",
                table: "EquipmentDefaultAccessories",
                columns: new[] { "ParentEquipmentType", "AccessoryEquipmentType", "AccessorySerialCode" },
                unique: true);
        }
    }
}
