using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;
using SoundRent.Api.Infrastructure.Data;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDbContext))]
    [Migration("20260721020000_AddEquipmentDefaultAccessories")]
    public class AddEquipmentDefaultAccessories : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "EquipmentDefaultAccessories",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ParentEquipmentType = table.Column<int>(type: "integer", nullable: false),
                    AccessoryEquipmentType = table.Column<int>(type: "integer", nullable: false),
                    AccessorySerialCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EquipmentDefaultAccessories", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_EquipmentDefaultAccessories_Parent",
                table: "EquipmentDefaultAccessories",
                column: "ParentEquipmentType");

            migrationBuilder.CreateIndex(
                name: "IX_EquipmentDefaultAccessories_Parent_Type_Code",
                table: "EquipmentDefaultAccessories",
                columns: new[] { "ParentEquipmentType", "AccessoryEquipmentType", "AccessorySerialCode" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EquipmentDefaultAccessories");
        }
    }
}
