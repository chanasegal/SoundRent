import { Injectable } from '@angular/core';

export interface ExcelSheetExport {
  sheetName: string;
  rows: Record<string, unknown>[];
}

type XlsxModule = typeof import('xlsx-js-style');

export interface ExcelExportOptions {
  /** Defaults to true (Hebrew layouts). Pass false only for LTR sheets. */
  rtl?: boolean;
  sheetName?: string;
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  private xlsxPromise: Promise<XlsxModule> | null = null;

  /**
   * Builds an .xlsx workbook from an array of plain objects (one row per object)
   * and triggers a browser download.
   */
  async exportToExcel(
    data: unknown[],
    fileName: string,
    options?: ExcelExportOptions
  ): Promise<void> {
    if (!data?.length) {
      return;
    }
    const rtl = options?.rtl !== false;
    const XLSX = await this.loadXlsx();
    const rows = (data as Record<string, unknown>[]).map((row) => this.normalizeRow(row));
    const ws = XLSX.utils.json_to_sheet(rows);
    this.applyWorksheetLayout(XLSX, ws, rows, rtl);
    const wb = XLSX.utils.book_new();
    if (rtl) {
      this.applyRtlWorkbook(wb);
    }
    XLSX.utils.book_append_sheet(wb, ws, this.sanitizeSheetName(options?.sheetName ?? 'Data'));
    this.writeWorkbook(XLSX, wb, fileName);
  }

  /**
   * Multi-sheet workbook (e.g. orders + waitlist). Empty `rows` yields a sheet with a short placeholder row.
   */
  async exportMultiSheetExcel(sheets: readonly ExcelSheetExport[], fileName: string): Promise<void> {
    if (!sheets?.length) {
      return;
    }
    const XLSX = await this.loadXlsx();
    const wb = XLSX.utils.book_new();
    this.applyRtlWorkbook(wb);
    for (const sheet of sheets) {
      const name = this.sanitizeSheetName(sheet.sheetName);
      if (sheet.rows.length === 0) {
        const placeholder = [{ הערה: '(אין רשומות בגיליון זה)' }];
        const ws = XLSX.utils.json_to_sheet(placeholder);
        this.applyWorksheetLayout(XLSX, ws, placeholder, true);
        XLSX.utils.book_append_sheet(wb, ws, name);
        continue;
      }
      const rows = sheet.rows.map((row) => this.normalizeRow(row));
      const ws = XLSX.utils.json_to_sheet(rows);
      this.applyWorksheetLayout(XLSX, ws, rows, true);
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    this.writeWorkbook(XLSX, wb, fileName);
  }

  /** Formats an ISO / Date value as `yyyy-MM-dd HH:mm` in Asia/Jerusalem. */
  formatExcelDateTime(value: string | Date | null | undefined): string {
    if (value == null || value === '') {
      return '';
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return typeof value === 'string' ? value : '';
    }

    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(date);

    const get = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((p) => p.type === type)?.value ?? '';

    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
  }

  private loadXlsx(): Promise<XlsxModule> {
    // xlsx-js-style is CJS; under ESM dynamic import the API lives on `default`.
    this.xlsxPromise ??= import('xlsx-js-style').then((mod) => {
      const api = (mod as { default?: XlsxModule }).default ?? (mod as XlsxModule);
      return api;
    });
    return this.xlsxPromise;
  }

  private writeWorkbook(
    XLSX: XlsxModule,
    wb: import('xlsx-js-style').WorkBook,
    fileName: string
  ): void {
    const name = fileName.toLowerCase().endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
    XLSX.writeFile(wb, name);
  }

  private applyWorksheetLayout(
    XLSX: XlsxModule,
    ws: import('xlsx-js-style').WorkSheet,
    rows: Record<string, unknown>[],
    rtl: boolean
  ): void {
    if (rtl) {
      ws['!views'] = [{ RTL: true }];
    }
    this.applyBoldHeaderRow(XLSX, ws);
    this.autoFitColumns(ws, rows);
  }

  private applyRtlWorkbook(wb: import('xlsx-js-style').WorkBook): void {
    if (!wb.Workbook) {
      wb.Workbook = {};
    }
    wb.Workbook.Views = [{ RTL: true }];
  }

  private applyBoldHeaderRow(XLSX: XlsxModule, ws: import('xlsx-js-style').WorkSheet): void {
    const ref = ws['!ref'];
    if (!ref) {
      return;
    }
    const range = XLSX.utils.decode_range(ref);
    for (let col = range.s.c; col <= range.e.c; col++) {
      const addr = XLSX.utils.encode_cell({ r: 0, c: col });
      const cell = ws[addr];
      if (!cell) {
        continue;
      }
      cell.s = {
        font: { bold: true },
        alignment: { horizontal: 'right', vertical: 'center' }
      };
    }
  }

  private autoFitColumns(
    ws: import('xlsx-js-style').WorkSheet,
    rows: Record<string, unknown>[]
  ): void {
    if (rows.length === 0) {
      return;
    }
    const headers = Object.keys(rows[0]);
    const padding = 3;
    const minWidth = 8;
    const maxWidth = 60;

    ws['!cols'] = headers.map((header) => {
      let maxLen = this.displayWidth(header);
      for (const row of rows) {
        maxLen = Math.max(maxLen, this.displayWidth(row[header]));
      }
      return { wch: Math.min(Math.max(maxLen + padding, minWidth), maxWidth) };
    });
  }

  private normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      next[key] = this.normalizeCellValue(value);
    }
    return next;
  }

  private normalizeCellValue(value: unknown): unknown {
    if (value instanceof Date) {
      return this.formatExcelDateTime(value);
    }
    if (typeof value === 'string' && this.looksLikeIsoDateTime(value)) {
      return this.formatExcelDateTime(value);
    }
    return value ?? '';
  }

  /** True for full ISO-8601 date-times (not bare `yyyy-MM-dd` calendar dates). */
  private looksLikeIsoDateTime(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) {
      return false;
    }
    const parsed = new Date(value);
    return !Number.isNaN(parsed.getTime());
  }

  /** Approximate display width: Hebrew/CJK glyphs count slightly wider than Latin. */
  private displayWidth(value: unknown): number {
    const text = value == null ? '' : String(value);
    let width = 0;
    for (const ch of text) {
      width += /[\u0590-\u05FF\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF]/.test(ch) ? 1.2 : 1;
    }
    return Math.ceil(width);
  }

  /** Excel sheet names: max 31 chars; no : \\ / ? * [ ] */
  private sanitizeSheetName(name: string): string {
    const cleaned = name.replace(/[\\/:?\[\]*]/g, '').trim();
    const base = cleaned.length > 0 ? cleaned : 'Sheet';
    return base.length > 31 ? base.slice(0, 31) : base;
  }
}
