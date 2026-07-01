using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLostEquipment : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "LostEquipments",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CustomerName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ItemDescription = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    HebrewDate = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false, defaultValue: 0),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LostEquipments", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_LostEquipments_CreatedAt",
                table: "LostEquipments",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_LostEquipments_Status",
                table: "LostEquipments",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "LostEquipments");
        }
    }
}
