using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;
using SoundRent.Api.Infrastructure.Data;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDbContext))]
    [Migration("20260720220000_AddManualUnreturnedItems")]
    public class AddManualUnreturnedItems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ManualUnreturnedItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    InventoryDefinitionId = table.Column<int>(type: "integer", nullable: true),
                    LoanedEquipmentType = table.Column<int>(type: "integer", nullable: true),
                    ItemName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ItemCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    IsResolved = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ManualUnreturnedItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ManualUnreturnedItems_InventoryDefinitions_InventoryDefinitionId",
                        column: x => x.InventoryDefinitionId,
                        principalTable: "InventoryDefinitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ManualUnreturnedItems_CreatedAt",
                table: "ManualUnreturnedItems",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_ManualUnreturnedItems_InventoryDefinitionId",
                table: "ManualUnreturnedItems",
                column: "InventoryDefinitionId");

            migrationBuilder.CreateIndex(
                name: "IX_ManualUnreturnedItems_IsResolved",
                table: "ManualUnreturnedItems",
                column: "IsResolved");

            migrationBuilder.CreateIndex(
                name: "IX_ManualUnreturnedItems_Code_Resolved",
                table: "ManualUnreturnedItems",
                columns: new[] { "ItemCode", "IsResolved" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ManualUnreturnedItems");
        }
    }
}
