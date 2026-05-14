import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';

export interface ExcelSheetExport {
  sheetName: string;
  rows: Record<string, unknown>[];
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  /**
   * Builds an .xlsx workbook from an array of plain objects (one row per object)
   * and triggers a browser download.
   */
  exportToExcel(data: unknown[], fileName: string): void {
    if (!data?.length) {
      return;
    }
    const ws = XLSX.utils.json_to_sheet(data as object[]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, this.sanitizeSheetName('Data'));
    this.writeWorkbook(wb, fileName);
  }

  /**
   * Multi-sheet workbook (e.g. orders + waitlist). Empty `rows` yields a sheet with a short placeholder row.
   */
  exportMultiSheetExcel(sheets: readonly ExcelSheetExport[], fileName: string): void {
    if (!sheets?.length) {
      return;
    }
    const wb = XLSX.utils.book_new();
    for (const sheet of sheets) {
      const name = this.sanitizeSheetName(sheet.sheetName);
      const ws =
        sheet.rows.length > 0
          ? XLSX.utils.json_to_sheet(sheet.rows as object[])
          : XLSX.utils.aoa_to_sheet([['(אין רשומות בגיליון זה)']]);
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    this.writeWorkbook(wb, fileName);
  }

  private writeWorkbook(wb: XLSX.WorkBook, fileName: string): void {
    const name = fileName.toLowerCase().endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
    XLSX.writeFile(wb, name);
  }

  /** Excel sheet names: max 31 chars; no : \\ / ? * [ ] */
  private sanitizeSheetName(name: string): string {
    const cleaned = name.replace(/[\\/:?\[\]*]/g, '').trim();
    const base = cleaned.length > 0 ? cleaned : 'Sheet';
    return base.length > 31 ? base.slice(0, 31) : base;
  }
}
