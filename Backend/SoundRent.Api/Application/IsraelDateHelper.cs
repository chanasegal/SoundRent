namespace SoundRent.Api.Application;

/// <summary>
/// "Today" for order-date comparisons uses the calendar date in Israel (Asia/Jerusalem),
/// not UTC midnight, so slot deletion aligns with local business days.
/// </summary>
public static class IsraelDateHelper
{
    public static TimeZoneInfo IsraelTimeZone { get; } = ResolveIsraelTimeZone();

    public static DateOnly TodayInIsrael()
    {
        var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, IsraelTimeZone);
        return DateOnly.FromDateTime(local.Date);
    }

    private static TimeZoneInfo ResolveIsraelTimeZone()
    {
        try
        {
            return TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
        }
        catch (TimeZoneNotFoundException)
        {
            return TimeZoneInfo.Utc;
        }
        catch (InvalidTimeZoneException)
        {
            return TimeZoneInfo.Utc;
        }
    }
}
