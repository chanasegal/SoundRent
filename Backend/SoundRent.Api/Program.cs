using System.IO.Compression;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using SoundRent.Api.Application.Auth;
using SoundRent.Api.Application.Services;
using SoundRent.Api.Filters;
using SoundRent.Api.Infrastructure.Data;
using SoundRent.Api.Infrastructure.Repositories;
using SoundRent.Api.Middleware;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

var builder = WebApplication.CreateBuilder(args);
var isDevelopment = builder.Environment.IsDevelopment();

// --- Configuration -------------------------------------------------------
builder.Services.Configure<JwtSettings>(
    builder.Configuration.GetSection(JwtSettings.SectionName));

var jwtSettings = builder.Configuration
    .GetSection(JwtSettings.SectionName)
    .Get<JwtSettings>() ?? throw new InvalidOperationException("JWT settings are missing.");

var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins")
    .Get<string[]>() ?? new[] { "http://localhost:4200" };

// --- EF Core -------------------------------------------------------------
var connectionString = ResolveDatabaseConnectionString(builder);
builder.Services.AddDbContext<AppDbContext>(options =>
{
    options.UseNpgsql(
        connectionString,
        npgsql =>
        {
            // Split queries avoid cartesian explosion on order graphs (loans + notes + shifts).
            npgsql.UseQuerySplittingBehavior(QuerySplittingBehavior.SplitQuery);
            // Cloud Postgres / PgBouncer often drops the TCP stream mid-read
            // (Npgsql EndOfStreamException). Retry the whole command with backoff.
            npgsql.EnableRetryOnFailure(
                maxRetryCount: 6,
                maxRetryDelay: TimeSpan.FromSeconds(20),
                errorCodesToAdd: null);
            npgsql.CommandTimeout(60);
        });

    if (isDevelopment)
    {
        options.EnableDetailedErrors();
        options.EnableSensitiveDataLogging();
        options.LogTo(
            Console.WriteLine,
            new[] { DbLoggerCategory.Database.Command.Name },
            LogLevel.Information);
    }
});

// --- DI: Repositories & Services -----------------------------------------
builder.Services.AddScoped<IOrderRepository, OrderRepository>();
builder.Services.AddScoped<IWaitlistRepository, WaitlistRepository>();
builder.Services.AddScoped<IEquipmentRepository, EquipmentRepository>();
builder.Services.AddScoped<IEquipmentDefinitionRepository, EquipmentDefinitionRepository>();
builder.Services.AddScoped<ICustomerRepository, CustomerRepository>();
builder.Services.AddScoped<ICustomerService, CustomerService>();
builder.Services.AddScoped<IInstitutionRepository, InstitutionRepository>();
builder.Services.AddScoped<IInstitutionService, InstitutionService>();
builder.Services.AddScoped<IOrderService, OrderService>();
builder.Services.AddScoped<IWaitlistService, WaitlistService>();
builder.Services.AddScoped<IEquipmentService, EquipmentService>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IGeneralMemoService, GeneralMemoService>();
builder.Services.AddScoped<ILostEquipmentRepository, LostEquipmentRepository>();
builder.Services.AddScoped<ILostEquipmentService, LostEquipmentService>();
builder.Services.AddScoped<IBlockedDateRepository, BlockedDateRepository>();
builder.Services.AddScoped<IBlockedDateService, BlockedDateService>();
builder.Services.AddScoped<IEquipmentDefaultAccessoryService, EquipmentDefaultAccessoryService>();
builder.Services.AddScoped<IInventoryDefinitionRepository, InventoryDefinitionRepository>();
builder.Services.AddScoped<IInventoryDefinitionService, InventoryDefinitionService>();
builder.Services.AddScoped<IToolInventoryService, ToolInventoryService>();
builder.Services.AddScoped<IToolLoanService, ToolLoanService>();
builder.Services.AddScoped<IBookInventoryService, BookInventoryService>();
builder.Services.AddScoped<IBookLoanService, BookLoanService>();
builder.Services.AddScoped<IOpenDebtService, OpenDebtService>();
builder.Services.AddSingleton<ITokenService, TokenService>();

// --- Authentication (JWT) ------------------------------------------------
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.RequireHttpsMetadata = false;
        options.SaveToken = true;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtSettings.Issuer,
            ValidAudience = jwtSettings.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSettings.Key)),
            ClockSkew = TimeSpan.FromMinutes(1)
        };
    });

builder.Services.AddAuthorization();

// --- CORS ----------------------------------------------------------------
const string CorsPolicyName = "SoundRentCors";
builder.Services.AddCors(options =>
{
    options.AddPolicy(CorsPolicyName, policy =>
    {
        policy.WithOrigins(allowedOrigins)
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

// --- MVC / OpenAPI -------------------------------------------------------
builder.Services
    .AddControllers(options =>
    {
        // Marks ValidationException (and related) as handled → clean 400/404/401
        // and prevents the debugger from treating them as user-unhandled crashes.
        options.Filters.Add<ApiExceptionFilter>();
        options.Filters.Add<ApiExceptionFilterAsync>();
    })
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(
            new System.Text.Json.Serialization.JsonStringEnumConverter());
    });

builder.Services.AddOpenApi();

builder.Services.AddResponseCompression(options =>
{
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
});
builder.Services.Configure<BrotliCompressionProviderOptions>(options =>
{
    options.Level = CompressionLevel.Fastest;
});
builder.Services.Configure<GzipCompressionProviderOptions>(options =>
{
    options.Level = CompressionLevel.Fastest;
});

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAngular", policy =>
    {
        policy.WithOrigins("http://localhost:4200") 
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials();
    });
});

var app = builder.Build();

// --- Database migration (before pipeline — fixes missing-column errors on deploy) ---
try
{
    using var scope = app.Services.CreateScope();
    var dbContext = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var startupLogger = scope.ServiceProvider
        .GetRequiredService<ILoggerFactory>()
        .CreateLogger("Startup");

    LogDatabasePoolMode(startupLogger, connectionString);
    startupLogger.LogInformation("Applying pending Entity Framework migrations…");
    dbContext.Database.Migrate();
    startupLogger.LogInformation("Entity Framework migrations applied successfully.");

    await DbInitializer.InitializeAsync(app.Services);
}
catch (Exception ex)
{
    var startupLogger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
    startupLogger.LogCritical(
        ex,
        "Startup aborted: database migration or initialization failed.");
    return;
}

// --- Pipeline ------------------------------------------------------------
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseMiddleware<ExceptionHandlingMiddleware>();

app.UseResponseCompression();

if (app.Environment.IsDevelopment())
{
    app.UseCors("AllowAngular");
}
else
{
    app.UseCors(CorsPolicyName);
}
app.UseHttpsRedirection();

//app.UseCors(CorsPolicyName);

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

app.Run();

static string ResolveDatabaseConnectionString(WebApplicationBuilder builder)
{
    string? connectionString;
    if (builder.Environment.IsDevelopment())
    {
        connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
    }
    else
    {
        connectionString = Environment.GetEnvironmentVariable("CONNECTION_STRING");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
        }
    }

    if (string.IsNullOrWhiteSpace(connectionString))
    {
        throw new InvalidOperationException(
            "Database connection string is not configured. Set ConnectionStrings:DefaultConnection for local development, or CONNECTION_STRING for production.");
    }

    return AlignNpgsqlPooling(connectionString);
}

static void LogDatabasePoolMode(ILogger logger, string connectionString)
{
    try
    {
        var cs = new NpgsqlConnectionStringBuilder(connectionString);
        var host = cs.Host ?? string.Empty;
        var isPooler = host.Contains("pooler.supabase.com", StringComparison.OrdinalIgnoreCase);
        if (!isPooler)
        {
            logger.LogInformation("Postgres host {Host}:{Port} (direct / non-pooler).", host, cs.Port);
            return;
        }

        if (cs.Port == 6543)
        {
            logger.LogWarning(
                "Supabase transaction-mode pooler detected ({Host}:{Port}). Prefer session-mode pooler on port 5432 for EF split queries.",
                host,
                cs.Port);
            return;
        }

        logger.LogInformation(
            "Supabase session-mode pooler ({Host}:{Port}); Npgsql pooling Min={Min} Max={Max} KeepAlive={KeepAlive}s.",
            host,
            cs.Port,
            cs.MinPoolSize,
            cs.MaxPoolSize,
            cs.KeepAlive);
    }
    catch (Exception ex)
    {
        logger.LogWarning(ex, "Could not inspect database pooler mode from the connection string.");
    }
}

/// <summary>
/// Aligns Npgsql client pooling with Supabase PgBouncer.
/// Session pooler: *.pooler.supabase.com:5432 (safe for EF split queries / prepared statements).
/// Transaction pooler: *.pooler.supabase.com:6543 (no prepared statements; avoid for split graphs).
/// </summary>
static string AlignNpgsqlPooling(string connectionString)
{
    var incoming = new NpgsqlConnectionStringBuilder(connectionString);
    var maxPool = incoming.MaxPoolSize > 0 ? incoming.MaxPoolSize : 10;

    var cs = new NpgsqlConnectionStringBuilder(connectionString)
    {
        Pooling = true,
        MinPoolSize = 0,
        MaxPoolSize = Math.Clamp(maxPool, 5, 20),
        ConnectionIdleLifetime = 60,
        ConnectionPruningInterval = 10,
        Timeout = 15,
        KeepAlive = 30,
        TcpKeepAlive = true,
        Multiplexing = false,
        ApplicationName = string.IsNullOrWhiteSpace(incoming.ApplicationName)
            ? "SoundRent.Api"
            : incoming.ApplicationName
    };

    var host = cs.Host ?? string.Empty;
    var isSupabasePooler = host.Contains("pooler.supabase.com", StringComparison.OrdinalIgnoreCase);
    var isTransactionMode = isSupabasePooler && cs.Port == 6543;
    var isSessionMode = isSupabasePooler && cs.Port == 5432;

    if (isTransactionMode)
    {
        // Transaction pooling recycles the backend after each command — prepared
        // statements and multi-command split queries are not session-sticky.
        cs.MaxAutoPrepare = 0;
        cs.NoResetOnClose = true;
    }
    else if (isSessionMode)
    {
        cs.MaxAutoPrepare = 20;
    }

    return cs.ConnectionString;
}
