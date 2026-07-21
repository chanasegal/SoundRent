using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddToolLoanInstitution : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "InstitutionId",
                table: "ToolLoans",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InstitutionName",
                table: "ToolLoans",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_ToolLoans_InstitutionId",
                table: "ToolLoans",
                column: "InstitutionId");

            migrationBuilder.AddForeignKey(
                name: "FK_ToolLoans_Institutions_InstitutionId",
                table: "ToolLoans",
                column: "InstitutionId",
                principalTable: "Institutions",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_ToolLoans_Institutions_InstitutionId",
                table: "ToolLoans");

            migrationBuilder.DropIndex(
                name: "IX_ToolLoans_InstitutionId",
                table: "ToolLoans");

            migrationBuilder.DropColumn(
                name: "InstitutionId",
                table: "ToolLoans");

            migrationBuilder.DropColumn(
                name: "InstitutionName",
                table: "ToolLoans");
        }
    }
}
