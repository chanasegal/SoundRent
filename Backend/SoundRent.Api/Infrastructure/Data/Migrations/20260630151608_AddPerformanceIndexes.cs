using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddPerformanceIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_WaitlistEntries_WaitlistDate",
                table: "WaitlistEntries",
                column: "WaitlistDate");

            migrationBuilder.CreateIndex(
                name: "IX_Orders_IsCancelled",
                table: "Orders",
                column: "IsCancelled");

            migrationBuilder.CreateIndex(
                name: "IX_Orders_IsPaid",
                table: "Orders",
                column: "IsPaid");

            migrationBuilder.CreateIndex(
                name: "IX_Orders_Phone",
                table: "Orders",
                column: "Phone");

            migrationBuilder.CreateIndex(
                name: "IX_Orders_Phone2",
                table: "Orders",
                column: "Phone2",
                filter: "\"Phone2\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Customers_UpdatedAt",
                table: "Customers",
                column: "UpdatedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_WaitlistEntries_WaitlistDate",
                table: "WaitlistEntries");

            migrationBuilder.DropIndex(
                name: "IX_Orders_IsCancelled",
                table: "Orders");

            migrationBuilder.DropIndex(
                name: "IX_Orders_IsPaid",
                table: "Orders");

            migrationBuilder.DropIndex(
                name: "IX_Orders_Phone",
                table: "Orders");

            migrationBuilder.DropIndex(
                name: "IX_Orders_Phone2",
                table: "Orders");

            migrationBuilder.DropIndex(
                name: "IX_Customers_UpdatedAt",
                table: "Customers");
        }
    }
}
