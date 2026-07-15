using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddLibraryBooksWorkspace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "BookLoanItemId",
                table: "CustomerDebts",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "BookLoans",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    LentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    HebrewLentDisplay = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    ClientName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Phone = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    Deposit = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Notes = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    DeadlineAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    ReturnedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    HebrewReturnedDisplay = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookLoans", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Books",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Title = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Author = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    Category = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Books", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "BookLoanItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    BookLoanId = table.Column<int>(type: "integer", nullable: false),
                    BookId = table.Column<int>(type: "integer", nullable: false),
                    BookTitle = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    CopyNumber = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ReturnedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    HebrewReturnedDisplay = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    ChargeAmount = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookLoanItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BookLoanItems_BookLoans_BookLoanId",
                        column: x => x.BookLoanId,
                        principalTable: "BookLoans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "BookCopies",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    BookId = table.Column<int>(type: "integer", nullable: false),
                    CopyNumber = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BookCopies", x => x.Id);
                    table.ForeignKey(
                        name: "FK_BookCopies_Books_BookId",
                        column: x => x.BookId,
                        principalTable: "Books",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CustomerDebts_BookLoanItemId",
                table: "CustomerDebts",
                column: "BookLoanItemId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BookCopies_BookId",
                table: "BookCopies",
                column: "BookId");

            migrationBuilder.CreateIndex(
                name: "IX_BookCopies_BookId_CopyNumber",
                table: "BookCopies",
                columns: new[] { "BookId", "CopyNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BookLoanItems_BookId",
                table: "BookLoanItems",
                column: "BookId");

            migrationBuilder.CreateIndex(
                name: "IX_BookLoanItems_BookLoanId",
                table: "BookLoanItems",
                column: "BookLoanId");

            migrationBuilder.CreateIndex(
                name: "IX_BookLoanItems_CopyNumber",
                table: "BookLoanItems",
                column: "CopyNumber");

            migrationBuilder.CreateIndex(
                name: "IX_BookLoanItems_ReturnedAt",
                table: "BookLoanItems",
                column: "ReturnedAt");

            migrationBuilder.CreateIndex(
                name: "IX_BookLoans_LentAt",
                table: "BookLoans",
                column: "LentAt");

            migrationBuilder.CreateIndex(
                name: "IX_BookLoans_Phone",
                table: "BookLoans",
                column: "Phone");

            migrationBuilder.CreateIndex(
                name: "IX_BookLoans_ReturnedAt",
                table: "BookLoans",
                column: "ReturnedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Books_SortOrder",
                table: "Books",
                column: "SortOrder");

            migrationBuilder.CreateIndex(
                name: "IX_Books_Title",
                table: "Books",
                column: "Title",
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_CustomerDebts_BookLoanItems_BookLoanItemId",
                table: "CustomerDebts",
                column: "BookLoanItemId",
                principalTable: "BookLoanItems",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_CustomerDebts_BookLoanItems_BookLoanItemId",
                table: "CustomerDebts");

            migrationBuilder.DropTable(
                name: "BookCopies");

            migrationBuilder.DropTable(
                name: "BookLoanItems");

            migrationBuilder.DropTable(
                name: "Books");

            migrationBuilder.DropTable(
                name: "BookLoans");

            migrationBuilder.DropIndex(
                name: "IX_CustomerDebts_BookLoanItemId",
                table: "CustomerDebts");

            migrationBuilder.DropColumn(
                name: "BookLoanItemId",
                table: "CustomerDebts");
        }
    }
}
