using System.Text;

namespace SoundRent.Api.Application.PhoneNumbers;

public static class PhoneNumberNormalizer
{
    /// <summary>Returns digits only (empty string if none).</summary>
    public static string DigitsOnly(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var sb = new StringBuilder(value.Length);
        foreach (var c in value)
        {
            if (char.IsDigit(c))
            {
                sb.Append(c);
            }
        }

        return sb.ToString();
    }

    /// <summary>Israeli-style numbers used in the app: 9 or 10 digits after stripping separators.</summary>
    public static bool IsValidStoredPhone(string? digits)
    {
        if (string.IsNullOrEmpty(digits))
        {
            return false;
        }

        return digits.Length is 9 or 10;
    }
}
