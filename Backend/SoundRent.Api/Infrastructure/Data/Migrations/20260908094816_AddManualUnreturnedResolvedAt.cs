using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddManualUnreturnedResolvedAt : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "ResolvedAt",
                table: "ManualUnreturnedItems",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ResolvedAt",
                table: "ManualUnreturnedItems");
        }
    }
}
