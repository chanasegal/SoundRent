namespace SoundRent.Api.Application;

/// <summary>
/// Sorts codes/numbers numerically when both values are integers (1, 2, 10),
/// otherwise falls back to ordinal-ignore-case string compare.
/// </summary>
public sealed class NumericStringComparer : IComparer<string>
{
    public static readonly NumericStringComparer Instance = new();

    public int Compare(string? x, string? y)
    {
        var a = (x ?? string.Empty).Trim();
        var b = (y ?? string.Empty).Trim();

        if (int.TryParse(a, out var aNum) && int.TryParse(b, out var bNum))
        {
            return aNum.CompareTo(bNum);
        }

        return StringComparer.OrdinalIgnoreCase.Compare(a, b);
    }
}
