using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddInstitutionSystems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "InstitutionSystems",
                columns: table => new
                {
                    InstitutionId = table.Column<int>(type: "integer", nullable: false),
                    SystemType = table.Column<int>(type: "integer", nullable: false),
                    LinkedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_InstitutionSystems", x => new { x.InstitutionId, x.SystemType });
                    table.ForeignKey(
                        name: "FK_InstitutionSystems_Institutions_InstitutionId",
                        column: x => x.InstitutionId,
                        principalTable: "Institutions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_InstitutionSystems_SystemType",
                table: "InstitutionSystems",
                column: "SystemType");

            // Existing institutions belong to Sound by default (historical order directory).
            migrationBuilder.Sql(
                """
                INSERT INTO "InstitutionSystems" ("InstitutionId", "SystemType", "LinkedAt")
                SELECT i."Id", 0, CURRENT_TIMESTAMP
                FROM "Institutions" i
                WHERE NOT EXISTS (
                    SELECT 1 FROM "InstitutionSystems" s
                    WHERE s."InstitutionId" = i."Id" AND s."SystemType" = 0
                );
                """);

            // Institutions already used on tool loans are also linked to Tools.
            migrationBuilder.Sql(
                """
                INSERT INTO "InstitutionSystems" ("InstitutionId", "SystemType", "LinkedAt")
                SELECT DISTINCT tl."InstitutionId", 1, CURRENT_TIMESTAMP
                FROM "ToolLoans" tl
                WHERE tl."InstitutionId" IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM "InstitutionSystems" s
                    WHERE s."InstitutionId" = tl."InstitutionId" AND s."SystemType" = 1
                  );
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "InstitutionSystems");
        }
    }
}
