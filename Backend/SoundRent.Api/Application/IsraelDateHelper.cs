namespace SoundRent.Api.Application;

/// <summary>
/// Calendar helpers for Israel (Asia/Jerusalem). Business "days" follow the Israel
/// civil date, not UTC midnight — late-night local stamps must not shift to the
/// previous/next UTC calendar day.
/// </summary>
public static class IsraelDateHelper
{
    public static TimeZoneInfo IsraelTimeZone { get; } = ResolveIsraelTimeZone();

    public static DateOnly TodayInIsrael()
    {
        return ToIsraelDateOnly(DateTime.UtcNow);
    }

    /// <summary>Normalizes a stored instant to UTC (Unspecified is treated as UTC).</summary>
    public static DateTime ToUtc(DateTime value)
    {
        return value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
        };
    }

    /// <summary>Israel civil calendar day for a UTC/local/unspecified instant.</summary>
    public static DateOnly ToIsraelDateOnly(DateTime value)
    {
        var israel = TimeZoneInfo.ConvertTimeFromUtc(ToUtc(value), IsraelTimeZone);
        return DateOnly.FromDateTime(israel);
    }

    /// <summary>
    /// UTC instant for midnight at the start of an Israel civil calendar day.
    /// Used when inventing a return stamp from a date-only return day.
    /// </summary>
    public static DateTime IsraelCalendarDayStartUtc(DateOnly day)
    {
        var localMidnight = DateTime.SpecifyKind(
            day.ToDateTime(TimeOnly.MinValue),
            DateTimeKind.Unspecified);
        return TimeZoneInfo.ConvertTimeToUtc(localMidnight, IsraelTimeZone);
    }

    private static TimeZoneInfo ResolveIsraelTimeZone()
    {
        foreach (var id in new[] { "Asia/Jerusalem", "Israel Standard Time" })
        {
            try
            {
                return TimeZoneInfo.FindSystemTimeZoneById(id);
            }
            catch (TimeZoneNotFoundException)
            {
            }
            catch (InvalidTimeZoneException)
            {
            }
        }

        return TimeZoneInfo.Utc;
    }
}
