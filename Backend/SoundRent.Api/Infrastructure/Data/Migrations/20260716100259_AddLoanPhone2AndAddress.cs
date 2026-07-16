using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLoanPhone2AndAddress : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Address",
                table: "ToolLoans",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Phone2",
                table: "ToolLoans",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Address",
                table: "BookLoans",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Phone2",
                table: "BookLoans",
                type: "character varying(20)",
                maxLength: 20,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Address",
                table: "ToolLoans");

            migrationBuilder.DropColumn(
                name: "Phone2",
                table: "ToolLoans");

            migrationBuilder.DropColumn(
                name: "Address",
                table: "BookLoans");

            migrationBuilder.DropColumn(
                name: "Phone2",
                table: "BookLoans");
        }
    }
}
