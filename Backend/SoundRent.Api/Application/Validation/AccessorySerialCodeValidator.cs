using System.Text.RegularExpressions;
using SoundRent.Api.Domain.Enums;

namespace SoundRent.Api.Application.Validation;

public static partial class AccessorySerialCodeValidator
{
    private static readonly Regex NumericOnly = NumericOnlyRegex();
    private static readonly Regex MicrophoneCode = MicrophoneCodeRegex();

    public const string NumericOnlyMessage = "קוד ציוד חייב להכיל ספרות בלבד";
    public const string MicrophoneCodeMessage = "קוד מיקרופון יכול להכיל אותיות, ספרות ומקף בלבד";

    public static bool IsValid(LoanedEquipmentType equipmentType, string? code)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            return false;
        }

        var trimmed = code.Trim();
        if (trimmed.Length == 0 || trimmed.Length > 100)
        {
            return false;
        }

        return equipmentType == LoanedEquipmentType.Microphone
            ? MicrophoneCode.IsMatch(trimmed)
            : NumericOnly.IsMatch(trimmed);
    }

    public static string InvalidMessageFor(LoanedEquipmentType equipmentType) =>
        equipmentType == LoanedEquipmentType.Microphone
            ? MicrophoneCodeMessage
            : NumericOnlyMessage;

    [GeneratedRegex(@"^\d+$")]
    private static partial Regex NumericOnlyRegex();

    [GeneratedRegex(@"^[A-Za-z0-9\-]+$")]
    private static partial Regex MicrophoneCodeRegex();
}
