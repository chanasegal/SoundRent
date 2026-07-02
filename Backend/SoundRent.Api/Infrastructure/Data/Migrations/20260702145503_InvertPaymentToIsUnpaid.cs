using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class InvertPaymentToIsUnpaid : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsUnpaid",
                table: "Orders",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.Sql(
                """
                UPDATE "Orders"
                SET "IsUnpaid" = false;
                """);

            migrationBuilder.DropIndex(
                name: "IX_Orders_IsPaid",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "IsPaid",
                table: "Orders");

            migrationBuilder.CreateIndex(
                name: "IX_Orders_IsUnpaid",
                table: "Orders",
                column: "IsUnpaid");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Orders_IsUnpaid",
                table: "Orders");

            migrationBuilder.AddColumn<bool>(
                name: "IsPaid",
                table: "Orders",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.Sql(
                """
                UPDATE "Orders"
                SET "IsPaid" = NOT "IsUnpaid";
                """);

            migrationBuilder.DropColumn(
                name: "IsUnpaid",
                table: "Orders");

            migrationBuilder.CreateIndex(
                name: "IX_Orders_IsPaid",
                table: "Orders",
                column: "IsPaid");
        }
    }
}
