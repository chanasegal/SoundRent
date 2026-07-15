using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddCustomerDebtsAndToolCharges : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<decimal>(
                name: "ChargeAmount",
                table: "ToolLoanItems",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "CustomerDebts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CustomerName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Phone = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Amount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false),
                    IsPaid = table.Column<bool>(type: "boolean", nullable: false),
                    Category = table.Column<int>(type: "integer", nullable: false),
                    ItemDescription = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: false),
                    ChargedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SessionKey = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ToolLoanItemId = table.Column<int>(type: "integer", nullable: true),
                    SourceOrderId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CustomerDebts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CustomerDebts_ToolLoanItems_ToolLoanItemId",
                        column: x => x.ToolLoanItemId,
                        principalTable: "ToolLoanItems",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CustomerDebts_ChargedAt",
                table: "CustomerDebts",
                column: "ChargedAt");

            migrationBuilder.CreateIndex(
                name: "IX_CustomerDebts_IsPaid",
                table: "CustomerDebts",
                column: "IsPaid");

            migrationBuilder.CreateIndex(
                name: "IX_CustomerDebts_Phone",
                table: "CustomerDebts",
                column: "Phone");

            migrationBuilder.CreateIndex(
                name: "IX_CustomerDebts_SessionKey",
                table: "CustomerDebts",
                column: "SessionKey");

            migrationBuilder.CreateIndex(
                name: "IX_CustomerDebts_ToolLoanItemId",
                table: "CustomerDebts",
                column: "ToolLoanItemId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CustomerDebts");

            migrationBuilder.DropColumn(
                name: "ChargeAmount",
                table: "ToolLoanItems");
        }
    }
}
