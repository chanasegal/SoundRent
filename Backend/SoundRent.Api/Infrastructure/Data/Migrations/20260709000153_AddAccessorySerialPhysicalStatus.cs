using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAccessorySerialPhysicalStatus : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PhysicalStatus",
                table: "AccessorySerialInventory",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_AccessorySerialInventory_Type_PhysicalStatus",
                table: "AccessorySerialInventory",
                columns: new[] { "EquipmentType", "PhysicalStatus" });

            migrationBuilder.Sql("""
                UPDATE "AccessorySerialInventory" AS ai
                SET "PhysicalStatus" = 1
                FROM "LoanedEquipmentNotes" AS n
                INNER JOIN "OrderLoanedEquipments" AS le ON n."OrderLoanedEquipmentId" = le."Id"
                INNER JOIN "Orders" AS o ON le."OrderId" = o."Id"
                WHERE ai."EquipmentType" = le."LoanedEquipmentType"
                  AND TRIM(n."Content") <> ''
                  AND n."Content" IS NOT NULL
                  AND LOWER(ai."SerialCode") = LOWER(TRIM(n."Content"))
                  AND NOT n."IsReturned"
                  AND NOT o."IsCancelled"
                  AND NOT le."IsCustomItem"
                  AND le."LoanedEquipmentType" IS NOT NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_AccessorySerialInventory_Type_PhysicalStatus",
                table: "AccessorySerialInventory");

            migrationBuilder.DropColumn(
                name: "PhysicalStatus",
                table: "AccessorySerialInventory");
        }
    }
}
