using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using SoundRent.Api.Infrastructure.Data;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20260831180000_AddCustomerDebtNotes")]
public partial class AddCustomerDebtNotes : Migration
{
    /// <inheritdoc />
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "Notes",
            table: "CustomerDebts",
            type: "character varying(2000)",
            maxLength: 2000,
            nullable: true);
    }

    /// <inheritdoc />
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "Notes",
            table: "CustomerDebts");
    }
}
