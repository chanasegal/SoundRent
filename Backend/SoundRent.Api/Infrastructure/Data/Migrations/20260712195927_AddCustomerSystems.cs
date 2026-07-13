using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCustomerSystems : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CustomerSystems",
                columns: table => new
                {
                    CustomerPhone1 = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    SystemType = table.Column<int>(type: "integer", nullable: false),
                    LinkedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomerSystems", x => new { x.CustomerPhone1, x.SystemType });
                    table.ForeignKey(
                        name: "FK_CustomerSystems_Customers_CustomerPhone1",
                        column: x => x.CustomerPhone1,
                        principalTable: "Customers",
                        principalColumn: "Phone1",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CustomerSystems_SystemType",
                table: "CustomerSystems",
                column: "SystemType");

            // Existing customers belong to the Sound system by default.
            migrationBuilder.Sql(
                """
                INSERT INTO "CustomerSystems" ("CustomerPhone1", "SystemType", "LinkedAt")
                SELECT c."Phone1", 0, CURRENT_TIMESTAMP
                FROM "Customers" c
                WHERE NOT EXISTS (
                    SELECT 1 FROM "CustomerSystems" cs
                    WHERE cs."CustomerPhone1" = c."Phone1" AND cs."SystemType" = 0
                );
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CustomerSystems");
        }
    }
}
