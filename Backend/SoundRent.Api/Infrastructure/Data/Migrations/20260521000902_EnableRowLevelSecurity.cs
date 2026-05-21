using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace SoundRent.Api.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class EnableRowLevelSecurity : Migration
    {
        private static readonly string[] AppTables =
        [
            "Customers",
            "EquipmentDefinitions",
            "Equipments",
            "Orders",
            "OrderEquipments",
            "OrderShifts",
            "OrderLoanedEquipments",
            "LoanedEquipmentNotes",
            "Users",
            "WaitlistEntries",
            "__EFMigrationsHistory"
        ];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            foreach (var table in AppTables)
            {
                migrationBuilder.Sql($"""
                    ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY;
                    ALTER TABLE public."{table}" FORCE ROW LEVEL SECURITY;
                    REVOKE ALL ON TABLE public."{table}" FROM anon, authenticated;
                    """);
            }

            migrationBuilder.Sql("""
                REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            foreach (var table in AppTables)
            {
                migrationBuilder.Sql($"""
                    ALTER TABLE public."{table}" DISABLE ROW LEVEL SECURITY;
                    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."{table}" TO anon, authenticated;
                    """);
            }

            migrationBuilder.Sql("""
                GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
                """);
        }
    }
}
