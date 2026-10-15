using System;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;
using SoundRent.Api.Infrastructure.Data;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    [DbContext(typeof(AppDbContext))]
    [Migration("20261015180000_AddCashDeposits")]
    public class AddCashDeposits : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "CashDepositAmount",
                table: "Orders",
                type: "decimal(18,2)",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "CashDepositAmount",
                table: "ToolLoans",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "CashDepositAmount",
                table: "BookLoans",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CashDeposits",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CustomerName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Phone = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Address = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    ReceivedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SourceModule = table.Column<int>(type: "integer", nullable: false),
                    OrderId = table.Column<int>(type: "integer", nullable: true),
                    ToolLoanId = table.Column<int>(type: "integer", nullable: true),
                    BookLoanId = table.Column<int>(type: "integer", nullable: true),
                    Status = table.Column<int>(type: "integer", nullable: false),
                    ReturnedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Notes = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CashDeposits", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CashDeposits_Status",
                table: "CashDeposits",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_CashDeposits_Phone",
                table: "CashDeposits",
                column: "Phone");

            migrationBuilder.CreateIndex(
                name: "IX_CashDeposits_OrderId",
                table: "CashDeposits",
                column: "OrderId");

            migrationBuilder.CreateIndex(
                name: "IX_CashDeposits_ToolLoanId",
                table: "CashDeposits",
                column: "ToolLoanId");

            migrationBuilder.CreateIndex(
                name: "IX_CashDeposits_BookLoanId",
                table: "CashDeposits",
                column: "BookLoanId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CashDeposits");

            migrationBuilder.DropColumn(
                name: "CashDepositAmount",
                table: "Orders");

            migrationBuilder.DropColumn(
                name: "CashDepositAmount",
                table: "ToolLoans");

            migrationBuilder.DropColumn(
                name: "CashDepositAmount",
                table: "BookLoans");
        }
    }
}
