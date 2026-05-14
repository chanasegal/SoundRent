using Microsoft.EntityFrameworkCore;
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

        await db.Database.MigrateAsync();
        await equipmentService.EnsureAllEquipmentRowsExistAsync();

        var username = configuration["AdminSeed:Username"];
        var password = configuration["AdminSeed:Password"];

        if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password))
        {
            logger.LogInformation("Admin seed configuration not found - skipping admin seed.");
            return;
        }

        var anyUser = await db.Users.AnyAsync();
        if (anyUser)
        {
            return;
        }

        var admin = new User
        {
            Username = username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(password)
        };

        db.Users.Add(admin);
        await db.SaveChangesAsync();

        logger.LogInformation("Seeded default admin user '{Username}'.", username);
    }
}
