using SoundRent.Api.Application.PhoneNumbers;

namespace SoundRent.Api.Application.Validation;

public static class IsraeliPhoneValidator
{
    public const string InvalidPhoneMessage = "מספר טלפון לא תקין";

    public const string Phone1AlreadyTakenMessage =
        "לא ניתן לעדכן את מספר הטלפון, מכיוון שקיים כבר לקוח אחר במערכת עם מספר זה.";

    public static bool TryNormalizeRequired(string? value, out string digits)
    {
        digits = PhoneNumberNormalizer.DigitsOnly(value);
        return PhoneNumberNormalizer.IsValidIsraeliPhone(digits);
    }

    public static bool TryNormalizeOptional(string? value, out string? digits)
    {
        var stripped = PhoneNumberNormalizer.DigitsOnly(value);
        if (stripped.Length == 0)
        {
            digits = null;
            return true;
        }

        if (!PhoneNumberNormalizer.IsValidIsraeliPhone(stripped))
        {
            digits = null;
            return false;
        }

        digits = stripped;
        return true;
    }
}
