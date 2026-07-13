using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddInventoryDefinitions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "InventoryDefinitions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DisplayName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InventoryDefinitions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "InventorySerialCodes",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    InventoryDefinitionId = table.Column<int>(type: "integer", nullable: false),
                    SerialCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    PhysicalStatus = table.Column<int>(type: "integer", nullable: false, defaultValue: 0)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InventorySerialCodes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_InventorySerialCodes_InventoryDefinitions_InventoryDefiniti~",
                        column: x => x.InventoryDefinitionId,
                        principalTable: "InventoryDefinitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_InventoryDefinitions_DisplayName",
                table: "InventoryDefinitions",
                column: "DisplayName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InventoryDefinitions_SortOrder",
                table: "InventoryDefinitions",
                column: "SortOrder");

            migrationBuilder.CreateIndex(
                name: "IX_InventorySerialCodes_Definition_Code",
                table: "InventorySerialCodes",
                columns: new[] { "InventoryDefinitionId", "SerialCode" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_InventorySerialCodes_InventoryDefinitionId",
                table: "InventorySerialCodes",
                column: "InventoryDefinitionId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "InventorySerialCodes");

            migrationBuilder.DropTable(
                name: "InventoryDefinitions");
        }
    }
}
