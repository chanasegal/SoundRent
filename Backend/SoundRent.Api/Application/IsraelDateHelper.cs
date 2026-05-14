namespace SoundRent.Api.Application;

/// <summary>
/// "Today" for order-date comparisons uses the calendar date in Israel (Asia/Jerusalem),
/// not UTC midnight, so slot deletion aligns with local business days.
/// </summary>
public static class IsraelDateHelper
{
    public static DateOnly TodayInIsrael()
    {
        try
        {
            var tz = TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem");
            var local = TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, tz);
            return DateOnly.FromDateTime(local.Date);
        }
        catch (TimeZoneNotFoundException)
        {
            return DateOnly.FromDateTime(DateTime.UtcNow.Date);
        }
        catch (InvalidTimeZoneException)
        {
            return DateOnly.FromDateTime(DateTime.UtcNow.Date);
        }
    }
}
