using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using SoundRent.Api.Infrastructure.Data;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDbContext))]
    [Migration("20261028190000_AddToolDefinitionRequiresCode")]
    public class AddToolDefinitionRequiresCode : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Quantity",
                table: "ToolDefinitions",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "RequiresCode",
                table: "ToolDefinitions",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            // Backfill quantity from existing serial counts so stock totals stay accurate.
            migrationBuilder.Sql(
                """
                UPDATE "ToolDefinitions" AS d
                SET "Quantity" = COALESCE((
                    SELECT COUNT(*)::int
                    FROM "ToolSerialCodes" AS s
                    WHERE s."ToolDefinitionId" = d."Id"
                ), 0);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "RequiresCode",
                table: "ToolDefinitions");

            migrationBuilder.DropColumn(
                name: "Quantity",
                table: "ToolDefinitions");
        }
    }
}
