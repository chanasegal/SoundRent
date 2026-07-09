using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddAccessorySerialPerformanceIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_OrderShifts_Date_TimeSlot_OrderId",
                table: "OrderShifts",
                columns: new[] { "OrderDate", "TimeSlot", "OrderId" });

            migrationBuilder.CreateIndex(
                name: "IX_OrderLoanedEquipments_OrderId",
                table: "OrderLoanedEquipments",
                column: "OrderId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_OrderShifts_Date_TimeSlot_OrderId",
                table: "OrderShifts");

            migrationBuilder.DropIndex(
                name: "IX_OrderLoanedEquipments_OrderId",
                table: "OrderLoanedEquipments");
        }
    }
}
