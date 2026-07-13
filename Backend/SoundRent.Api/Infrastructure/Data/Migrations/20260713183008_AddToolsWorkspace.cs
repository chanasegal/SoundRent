using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddToolsWorkspace : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ToolDefinitions",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DisplayName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP"),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false, defaultValueSql: "CURRENT_TIMESTAMP")
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ToolDefinitions", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ToolLoans",
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
                    table.PrimaryKey("PK_ToolLoans", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "ToolSerialCodes",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ToolDefinitionId = table.Column<int>(type: "integer", nullable: false),
                    SerialCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ToolSerialCodes", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ToolSerialCodes_ToolDefinitions_ToolDefinitionId",
                        column: x => x.ToolDefinitionId,
                        principalTable: "ToolDefinitions",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "ToolLoanItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    ToolLoanId = table.Column<int>(type: "integer", nullable: false),
                    ToolDefinitionId = table.Column<int>(type: "integer", nullable: false),
                    ToolName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    SerialCode = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ToolLoanItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_ToolLoanItems_ToolLoans_ToolLoanId",
                        column: x => x.ToolLoanId,
                        principalTable: "ToolLoans",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ToolDefinitions_DisplayName",
                table: "ToolDefinitions",
                column: "DisplayName",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_ToolDefinitions_SortOrder",
                table: "ToolDefinitions",
                column: "SortOrder");

            migrationBuilder.CreateIndex(
                name: "IX_ToolLoanItems_SerialCode",
                table: "ToolLoanItems",
                column: "SerialCode");

            migrationBuilder.CreateIndex(
                name: "IX_ToolLoanItems_ToolDefinitionId",
                table: "ToolLoanItems",
                column: "ToolDefinitionId");

            migrationBuilder.CreateIndex(
                name: "IX_ToolLoanItems_ToolLoanId",
                table: "ToolLoanItems",
                column: "ToolLoanId");

            migrationBuilder.CreateIndex(
                name: "IX_ToolLoans_LentAt",
                table: "ToolLoans",
                column: "LentAt");

            migrationBuilder.CreateIndex(
                name: "IX_ToolLoans_Phone",
                table: "ToolLoans",
                column: "Phone");

            migrationBuilder.CreateIndex(
                name: "IX_ToolLoans_ReturnedAt",
                table: "ToolLoans",
                column: "ReturnedAt");

            migrationBuilder.CreateIndex(
                name: "IX_ToolSerialCodes_ToolDefinitionId",
                table: "ToolSerialCodes",
                column: "ToolDefinitionId");

            migrationBuilder.CreateIndex(
                name: "IX_ToolSerialCodes_ToolDefinitionId_SerialCode",
                table: "ToolSerialCodes",
                columns: new[] { "ToolDefinitionId", "SerialCode" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ToolLoanItems");

            migrationBuilder.DropTable(
                name: "ToolSerialCodes");

            migrationBuilder.DropTable(
                name: "ToolLoans");

            migrationBuilder.DropTable(
                name: "ToolDefinitions");
        }
    }
}
