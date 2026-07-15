using System.Net.Sockets;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using SoundRent.Api.Application.Services;
using SoundRent.Api.Domain.Entities;

namespace SoundRent.Api.Infrastructure.Data;

public static class DbInitializer
{
    public static async Task InitializeAsync(IServiceProvider services)
    {
        using var scope = services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var equipmentService = scope.ServiceProvider.GetRequiredService<IEquipmentService>();
        var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();
        var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("DbInitializer");

        var hostHint = TryGetHost(configuration.GetConnectionString("DefaultConnection"));

        try
        {
            logger.LogInformation(
                "Connecting to database{HostHint} and applying migrations…",
                string.IsNullOrEmpty(hostHint) ? string.Empty : $" (Host={hostHint})");

            await db.Database.MigrateAsync();
            await equipmentService.EnsureAllEquipmentRowsExistAsync();

            var inventoryDefinitions = scope.ServiceProvider.GetRequiredService<IInventoryDefinitionService>();
            await inventoryDefinitions.EnsureSystemTypesSeededAsync();

            await SeedAdminIfNeededAsync(db, configuration, logger);

            logger.LogInformation("Database initialization completed successfully.");
        }
        catch (Exception ex) when (IsConnectivityFailure(ex))
        {
            logger.LogCritical(
                ex,
                """
                Database is unreachable — the API will not start.
                Host resolved from connection string: {Host}
                Common fixes:
                  1. Open Backend/SoundRent.Api/appsettings.json → ConnectionStrings:DefaultConnection and verify Host=… (no typos).
                  2. For local Postgres use Host=localhost (or 127.0.0.1) with Port=5432 and a running local instance.
                  3. For Supabase/Render: confirm the project is active, copy the current pooler/connection host from the dashboard, and check DNS/VPN/NetFree are not blocking the hostname.
                  4. Test DNS: nslookup <host>   and port: Test-NetConnection <host> -Port 5432
                """,
                hostHint ?? "(missing Host in connection string)");

            throw new InvalidOperationException(
                $"Cannot connect to PostgreSQL at Host={hostHint ?? "?"}. See DbInitializer logs for details.",
                ex);
        }
    }

    private static async Task SeedAdminIfNeededAsync(
        AppDbContext db,
        IConfiguration configuration,
        ILogger logger)
    {
        var username = configuration["AdminSeed:Username"];
        var password = configuration["AdminSeed:Password"];

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
        {
            logger.LogInformation("Admin seed configuration not found - skipping admin seed.");
            return;
        }

        if (await db.Users.AnyAsync())
        {
            return;
        }

        db.Users.Add(new User
        {
            Username = username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password)
        });
        await db.SaveChangesAsync();

        logger.LogInformation("Seeded default admin user '{Username}'.", username);
    }

    private static string? TryGetHost(string? connectionString)
    {
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            return null;
        }

        try
        {
            return new NpgsqlConnectionStringBuilder(connectionString).Host;
        }
        catch
        {
            return null;
        }
    }

    private static bool IsConnectivityFailure(Exception ex)
    {
        for (var current = ex; current != null; current = current.InnerException)
        {
            if (current is SocketException or NpgsqlException or TimeoutException)
            {
                return true;
            }

            if (current is InvalidOperationException &&
                current.Message.Contains("connection", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }
}
