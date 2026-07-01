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

    /// <summary>Israeli mobile (05xxxxxxxx) or landline (02/03/04/07/08/09 + 7 digits).</summary>
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

        if (digits.Length == 10 && digits.StartsWith("05", StringComparison.Ordinal))
        {
            return true;
        }

        if (digits.Length == 9)
        {
            var prefix = digits[..2];
            return prefix is "02" or "03" or "04" or "07" or "08" or "09";
        }

        return false;
    }

    /// <summary>Israeli mobile (05xxxxxxxx) or landline (02/03/04/07/08/09 + 7 digits).</summary>
    public static bool IsValidStoredPhone(string? digits) => IsValidIsraeliPhone(digits);
}
