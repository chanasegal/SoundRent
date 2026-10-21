using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class UpdateOrderModelChanges : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "DepositReturned",
                table: "Orders",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "DepositReturned",
                table: "ToolLoans",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "DepositReturned",
                table: "BookLoans",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            // Align with cash-deposit ledger rows already marked returned.
            migrationBuilder.Sql("""
                UPDATE "Orders" o
                SET "DepositReturned" = TRUE
                WHERE EXISTS (
                    SELECT 1 FROM "CashDeposits" d
                    WHERE d."OrderId" = o."Id" AND d."Status" = 1
                );
                """);

            migrationBuilder.Sql("""
                UPDATE "ToolLoans" t
                SET "DepositReturned" = TRUE
                WHERE EXISTS (
                    SELECT 1 FROM "CashDeposits" d
                    WHERE d."ToolLoanId" = t."Id" AND d."Status" = 1
                );
                """);

            migrationBuilder.Sql("""
                UPDATE "BookLoans" b
                SET "DepositReturned" = TRUE
                WHERE EXISTS (
                    SELECT 1 FROM "CashDeposits" d
                    WHERE d."BookLoanId" = b."Id" AND d."Status" = 1
                );
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name: "DepositReturned", table: "Orders");
            migrationBuilder.DropColumn(name: "DepositReturned", table: "ToolLoans");
            migrationBuilder.DropColumn(name: "DepositReturned", table: "BookLoans");
        }
    }
}
