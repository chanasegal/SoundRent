using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemoveLoanedEquipmentTypeNoteDefaults : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "LoanedEquipmentTypeNoteDefaults");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "LoanedEquipmentTypeNoteDefaults",
                columns: table => new
                {
                    LoanedEquipmentType = table.Column<int>(type: "integer", nullable: false),
                    DefaultNoteCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LoanedEquipmentTypeNoteDefaults", x => x.LoanedEquipmentType);
                });
        }
    }
}
