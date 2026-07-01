import { Injectable } from '@angular/core';

export interface ExcelSheetExport {
  sheetName: string;
  rows: Record<string, unknown>[];
}

type XlsxModule = typeof import('xlsx');

export interface ExcelExportOptions {
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
    const XLSX = await this.loadXlsx();
    const ws = XLSX.utils.json_to_sheet(data as object[]);
    if (options?.rtl) {
      this.applyRtlWorksheet(ws);
    }
    const wb = XLSX.utils.book_new();
    if (options?.rtl) {
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
    for (const sheet of sheets) {
      const name = this.sanitizeSheetName(sheet.sheetName);
      const ws =
        sheet.rows.length > 0
          ? XLSX.utils.json_to_sheet(sheet.rows as object[])
          : XLSX.utils.aoa_to_sheet([['(אין רשומות בגיליון זה)']]);
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    this.writeWorkbook(XLSX, wb, fileName);
  }

  private loadXlsx(): Promise<XlsxModule> {
    this.xlsxPromise ??= import('xlsx');
    return this.xlsxPromise;
  }

  private writeWorkbook(XLSX: XlsxModule, wb: import('xlsx').WorkBook, fileName: string): void {
    const name = fileName.toLowerCase().endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
    XLSX.writeFile(wb, name);
  }

  private applyRtlWorksheet(ws: import('xlsx').WorkSheet): void {
    ws['!views'] = [{ RTL: true }];
  }

  private applyRtlWorkbook(wb: import('xlsx').WorkBook): void {
    if (!wb.Workbook) {
      wb.Workbook = {};
    }
    wb.Workbook.Views = [{ RTL: true }];
  }

  /** Excel sheet names: max 31 chars; no : \\ / ? * [ ] */
  private sanitizeSheetName(name: string): string {
    const cleaned = name.replace(/[\\/:?\[\]*]/g, '').trim();
    const base = cleaned.length > 0 ? cleaned : 'Sheet';
    return base.length > 31 ? base.slice(0, 31) : base;
  }
}
