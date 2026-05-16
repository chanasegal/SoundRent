using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using SoundRent.Api.Application.Auth;
using SoundRent.Api.Application.Services;
using SoundRent.Api.Infrastructure.Data;
using SoundRent.Api.Infrastructure.Repositories;
using SoundRent.Api.Middleware;

var builder = WebApplication.CreateBuilder(args);

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
    options.UseNpgsql(
        connectionString,
        npgsql => npgsql.UseQuerySplittingBehavior(QuerySplittingBehavior.SplitQuery)));

// --- DI: Repositories & Services -----------------------------------------
builder.Services.AddScoped<IOrderRepository, OrderRepository>();
builder.Services.AddScoped<IWaitlistRepository, WaitlistRepository>();
builder.Services.AddScoped<IEquipmentRepository, EquipmentRepository>();
builder.Services.AddScoped<IEquipmentDefinitionRepository, EquipmentDefinitionRepository>();
builder.Services.AddScoped<ICustomerRepository, CustomerRepository>();
builder.Services.AddScoped<ICustomerService, CustomerService>();
builder.Services.AddScoped<IOrderService, OrderService>();
builder.Services.AddScoped<IWaitlistService, WaitlistService>();
builder.Services.AddScoped<IEquipmentService, EquipmentService>();
builder.Services.AddScoped<IAuthService, AuthService>();
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
    .AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.Converters.Add(
            new System.Text.Json.Serialization.JsonStringEnumConverter());
    });

builder.Services.AddOpenApi();

builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAngular", policy =>
    {
        policy.WithOrigins("http://localhost:4200") // הכתובת של הפרונטנד שלך
              .AllowAnyMethod()
              .AllowAnyHeader()
              .AllowCredentials();
    });
});

var app = builder.Build();

// --- Pipeline ------------------------------------------------------------
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseMiddleware<ExceptionHandlingMiddleware>();

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

// --- Database migration & admin seed -------------------------------------
await DbInitializer.InitializeAsync(app.Services);

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

    return connectionString;
}
