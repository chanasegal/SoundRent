# ---- Build -----------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

COPY ["SoundRent.Api/SoundRent.Api.csproj", "SoundRent.Api/"]
RUN dotnet restore "SoundRent.Api/SoundRent.Api.csproj"

COPY ["SoundRent.Api/", "SoundRent.Api/"]
RUN dotnet publish "SoundRent.Api/SoundRent.Api.csproj" \
    -c Release \
    -o /app/publish \
    /p:UseAppHost=false

# ---- Runtime ---------------------------------------------------------------
FROM mcr.microsoft.com/dotnet/aspnet:9.0-bookworm-slim AS final
WORKDIR /app

ENV ASPNETCORE_URLS=http://+:8080

COPY --from=build /app/publish .

EXPOSE 8080

ENTRYPOINT ["dotnet", "SoundRent.Api.dll"]
