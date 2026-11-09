using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddBookSearchPerformanceIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_BookLoanItems_BookId_CopyNumber",
                table: "BookLoanItems",
                columns: new[] { "BookId", "CopyNumber" });

            migrationBuilder.CreateIndex(
                name: "IX_BookCopies_CopyNumber",
                table: "BookCopies",
                column: "CopyNumber");

            // Case-insensitive barcode equality uses LOWER(col) = @p — expression indexes.
            migrationBuilder.Sql(
                """
                CREATE INDEX IF NOT EXISTS "IX_BookCopies_CopyNumber_Lower"
                ON "BookCopies" (LOWER("CopyNumber"));
                """);

            migrationBuilder.Sql(
                """
                CREATE INDEX IF NOT EXISTS "IX_BookLoanItems_BookId_CopyNumber_Lower"
                ON "BookLoanItems" ("BookId", LOWER("CopyNumber"));
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""DROP INDEX IF EXISTS "IX_BookLoanItems_BookId_CopyNumber_Lower";""");
            migrationBuilder.Sql("""DROP INDEX IF EXISTS "IX_BookCopies_CopyNumber_Lower";""");

            migrationBuilder.DropIndex(
                name: "IX_BookLoanItems_BookId_CopyNumber",
                table: "BookLoanItems");

            migrationBuilder.DropIndex(
                name: "IX_BookCopies_CopyNumber",
                table: "BookCopies");
        }
    }
}
