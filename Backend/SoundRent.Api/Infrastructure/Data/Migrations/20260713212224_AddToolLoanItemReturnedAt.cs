using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddToolLoanItemReturnedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "HebrewReturnedDisplay",
                table: "ToolLoanItems",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ReturnedAt",
                table: "ToolLoanItems",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ToolLoanItems_ReturnedAt",
                table: "ToolLoanItems",
                column: "ReturnedAt");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ToolLoanItems_ReturnedAt",
                table: "ToolLoanItems");

            migrationBuilder.DropColumn(
                name: "HebrewReturnedDisplay",
                table: "ToolLoanItems");

            migrationBuilder.DropColumn(
                name: "ReturnedAt",
                table: "ToolLoanItems");
        }
    }
}
