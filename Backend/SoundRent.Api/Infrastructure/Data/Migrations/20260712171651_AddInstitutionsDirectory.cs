using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddInstitutionsDirectory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "InstitutionId",
                table: "Orders",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "Institutions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    DefaultNote = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Institutions", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Orders_InstitutionId",
                table: "Orders",
                column: "InstitutionId");

            migrationBuilder.CreateIndex(
                name: "IX_Institutions_Name",
                table: "Institutions",
                column: "Name",
                unique: true);

            // Safely promote existing free-text institution names into the directory.
            migrationBuilder.Sql(
                """
                INSERT INTO "Institutions" ("Name", "DefaultNote")
                SELECT DISTINCT TRIM("InstitutionName"), NULL
                FROM "Orders"
                WHERE "InstitutionName" IS NOT NULL
                  AND TRIM("InstitutionName") <> ''
                  AND NOT EXISTS (
                    SELECT 1
                    FROM "Institutions" i
                    WHERE LOWER(i."Name") = LOWER(TRIM("Orders"."InstitutionName"))
                  );
                """);

            migrationBuilder.Sql(
                """
                UPDATE "Orders" o
                SET "InstitutionId" = i."Id"
                FROM "Institutions" i
                WHERE o."InstitutionName" IS NOT NULL
                  AND TRIM(o."InstitutionName") <> ''
                  AND LOWER(TRIM(o."InstitutionName")) = LOWER(i."Name");
                """);

            migrationBuilder.AddForeignKey(
                name: "FK_Orders_Institutions_InstitutionId",
                table: "Orders",
                column: "InstitutionId",
                principalTable: "Institutions",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Orders_Institutions_InstitutionId",
                table: "Orders");

            migrationBuilder.DropTable(
                name: "Institutions");

            migrationBuilder.DropIndex(
                name: "IX_Orders_InstitutionId",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "InstitutionId",
                table: "Orders");
        }
    }
}
