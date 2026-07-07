using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCustomLoanedEquipmentFields : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_OrderLoanedEquipments_Order_Type_Unique",
                table: "OrderLoanedEquipments");

            migrationBuilder.AlterColumn<int>(
                name: "LoanedEquipmentType",
                table: "OrderLoanedEquipments",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AddColumn<string>(
                name: "CustomItemName",
                table: "OrderLoanedEquipments",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsCustomItem",
                table: "OrderLoanedEquipments",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_OrderLoanedEquipments_Order_Type_Unique",
                table: "OrderLoanedEquipments",
                columns: new[] { "OrderId", "LoanedEquipmentType" },
                unique: true,
                filter: "\"IsCustomItem\" = false");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_OrderLoanedEquipments_Order_Type_Unique",
                table: "OrderLoanedEquipments");

            migrationBuilder.DropColumn(
                name: "CustomItemName",
                table: "OrderLoanedEquipments");

            migrationBuilder.DropColumn(
                name: "IsCustomItem",
                table: "OrderLoanedEquipments");

            migrationBuilder.AlterColumn<int>(
                name: "LoanedEquipmentType",
                table: "OrderLoanedEquipments",
                type: "integer",
                nullable: false,
                defaultValue: 0,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_OrderLoanedEquipments_Order_Type_Unique",
                table: "OrderLoanedEquipments",
                columns: new[] { "OrderId", "LoanedEquipmentType" },
                unique: true);
        }
    }
}
