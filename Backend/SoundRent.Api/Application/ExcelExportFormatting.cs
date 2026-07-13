using ClosedXML.Excel;

namespace SoundRent.Api.Application;

/// <summary>
/// Shared ClosedXML layout polish for Hebrew Excel exports (RTL, bold header, auto-fit + padding).
/// </summary>
public static class ExcelExportFormatting
{
    private const double ColumnWidthPadding = 2.5;
    private const double MinColumnWidth = 8;
    private const double MaxColumnWidth = 60;

    public static void ApplyStandardLayout(
        IXLWorksheet worksheet,
        int headerRow,
        int columnCount,
        int lastDataRow)
    {
        if (columnCount <= 0)
        {
            return;
        }

        worksheet.RightToLeft = true;

        var lastRow = Math.Max(lastDataRow, headerRow);
        var usedRange = worksheet.Range(headerRow, 1, lastRow, columnCount);
        usedRange.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Right;
        usedRange.Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;

        var headerRange = worksheet.Range(headerRow, 1, headerRow, columnCount);
        headerRange.Style.Font.Bold = true;
        headerRange.Style.Fill.BackgroundColor = XLColor.FromHtml("#E0F2FE");
        headerRange.Style.Border.BottomBorder = XLBorderStyleValues.Thin;

        worksheet.Columns(1, columnCount).AdjustToContents();

        foreach (var column in worksheet.Columns(1, columnCount))
        {
            var padded = column.Width + ColumnWidthPadding;
            column.Width = Math.Clamp(padded, MinColumnWidth, MaxColumnWidth);
        }
    }

    /// <summary>Formats a UTC/local instant as <c>yyyy-MM-dd HH:mm</c> in Israel time.</summary>
    public static string FormatDateTime(DateTime value)
    {
        var utc = value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc)
        };

        var israel = TimeZoneInfo.ConvertTimeFromUtc(utc, IsraelDateHelper.IsraelTimeZone);
        return israel.ToString("yyyy-MM-dd HH:mm");
    }
}
