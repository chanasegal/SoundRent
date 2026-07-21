using System.Text;
using System.Text.RegularExpressions;

namespace SoundRent.Api.Application.PhoneNumbers;

public static partial class PhoneNumberNormalizer
{
    /// <summary>
    /// Israeli phones: 05x/07x (10 digits) or regional landline 02/03/04/08/09 (9 digits).
    /// Pattern: <c>^0(5\d|7\d|[23489])\d{7}$</c>
    /// </summary>
    [GeneratedRegex(@"^0(5\d|7\d|[23489])\d{7}$", RegexOptions.CultureInvariant)]
    private static partial Regex IsraeliPhoneRegex();

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

    /// <summary>
    /// Israeli cellular/VoIP (05xxxxxxxx / 07xxxxxxxx) or regional landline (02/03/04/08/09 + 7 digits).
    /// </summary>
    public static bool IsValidIsraeliPhone(string? digits)
    {
        if (string.IsNullOrEmpty(digits))
        {
            return false;
        }

        foreach (var c in digits)
        {
            if (!char.IsDigit(c))
            {
                return false;
            }
        }

        return IsraeliPhoneRegex().IsMatch(digits);
    }

    /// <summary>
    /// Israeli cellular/VoIP (05xxxxxxxx / 07xxxxxxxx) or regional landline (02/03/04/08/09 + 7 digits).
    /// </summary>
    public static bool IsValidStoredPhone(string? digits) => IsValidIsraeliPhone(digits);
}
