import { Injectable } from '@angular/core';
import { gematriya, HDate } from '@hebcal/core';

/** Decomposed Hebrew date in numeric form. */
export interface HebrewDateParts {
  /** Day of the Hebrew month (1-30). */
  day: number;
  /** Hebrew month index. 1=Nisan, 7=Tishrei, 12=Adar (or Adar I in a leap year), 13=Adar II (leap only). */
  month: number;
  /** Full Hebrew year (e.g. 5786). */
  year: number;
}

/** Option for a Hebrew-month dropdown. */
export interface HebrewMonthOption {
  /** Numeric month value used by `HDate` (1-13). */
  value: number;
  /** Display label in Hebrew (e.g. "תשרי", "אדר א׳"). */
  label: string;
}

/**
 * Hebrew month names. Indexed by the `HDate` month number (1=Nisan … 13=Adar II).
 * For a leap year, month 12 is labeled "אדר א׳" and 13 is "אדר ב׳"; otherwise 12 is plain "אדר".
 */
const HEBREW_MONTH_NAMES_REGULAR: Record<number, string> = {
  1: 'ניסן',
  2: 'אייר',
  3: 'סיון',
  4: 'תמוז',
  5: 'אב',
  6: 'אלול',
  7: 'תשרי',
  8: 'חשון',
  9: 'כסלו',
  10: 'טבת',
  11: 'שבט',
  12: 'אדר'
};

const HEBREW_MONTH_NAMES_LEAP: Record<number, string> = {
  ...HEBREW_MONTH_NAMES_REGULAR,
  12: 'אדר א׳',
  13: 'אדר ב׳'
};

/**
 * Display order of Hebrew months in a calendar year (civil year starts in Tishrei).
 * 13 (Adar II) is appended in the appropriate position only for leap years.
 */
const MONTH_DISPLAY_ORDER_REGULAR = [7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6];
const MONTH_DISPLAY_ORDER_LEAP = [7, 8, 9, 10, 11, 12, 13, 1, 2, 3, 4, 5, 6];

/** Hebrew names of the days of the week (Sun=0 … Sat=6). */
const HEBREW_DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

@Injectable({ providedIn: 'root' })
export class HebrewDateService {
  /**
   * Returns a Hebrew gematriya-formatted date for the given Gregorian date,
   * e.g. "כ״א אייר תשפ״ה".
   */
  toHebrew(date: Date): string {
    return new HDate(date).renderGematriya();
  }

  /**
   * Returns a "<startHebrew> – <endHebrew>" range string.
   */
  toHebrewRange(start: Date, end: Date): string {
    return `${this.toHebrew(start)} – ${this.toHebrew(end)}`;
  }

  /**
   * Decomposes a Gregorian `Date` into its Hebrew day / month / year parts.
   * Hours/minutes/seconds of the input are ignored (the Hebrew daytime is used).
   */
  toHebrewParts(date: Date): HebrewDateParts {
    const hd = new HDate(date);
    return { day: hd.getDate(), month: hd.getMonth(), year: hd.getFullYear() };
  }

  /**
   * Converts an ISO `yyyy-MM-dd` string into Hebrew parts.
   * Parses as a local date to avoid timezone drift.
   */
  isoToHebrewParts(iso: string): HebrewDateParts | null {
    const date = this.parseIso(iso);
    return date ? this.toHebrewParts(date) : null;
  }

  /**
   * Builds a Gregorian `Date` (local midnight) from the given Hebrew parts.
   */
  toGregorian(year: number, month: number, day: number): Date {
    return new HDate(day, month, year).greg();
  }

  /** Returns 29 or 30 — the number of days in the given Hebrew month/year. */
  daysInMonth(month: number, year: number): number {
    return HDate.daysInMonth(month, year);
  }

  /** Whether the given Hebrew year has 13 months. */
  isLeapYear(year: number): boolean {
    return HDate.isLeapYear(year);
  }

  /**
   * Returns the ordered list of months for the given Hebrew year — already in the
   * order they should appear in a dropdown (Tishrei → Elul).
   */
  monthsForYear(year: number): HebrewMonthOption[] {
    const leap = this.isLeapYear(year);
    const order = leap ? MONTH_DISPLAY_ORDER_LEAP : MONTH_DISPLAY_ORDER_REGULAR;
    const names = leap ? HEBREW_MONTH_NAMES_LEAP : HEBREW_MONTH_NAMES_REGULAR;
    return order.map((m) => ({ value: m, label: names[m] }));
  }

  /** Hebrew name of the day of week for a given Gregorian date (e.g. "חמישי"). */
  dayOfWeekHebrew(date: Date): string {
    return HEBREW_DAY_NAMES[date.getDay()];
  }

  /**
   * Renders a Hebrew day-of-month number as gematriya letters.
   * Examples: `1 → 'א׳'`, `15 → 'ט״ו'`, `23 → 'כ״ג'`.
   */
  dayGematriya(day: number): string {
    return gematriya(day);
  }

  /**
   * Renders a full Hebrew year as gematriya letters (thousands omitted for the
   * current millennium). Example: `5786 → 'תשפ״ו'`.
   */
  yearGematriya(year: number): string {
    return gematriya(year);
  }

  /**
   * Hebrew month label for a given month value, taking the year's leap status
   * into account (e.g. 12 → "אדר א׳" in leap years, "אדר" otherwise).
   */
  monthLabel(month: number, year: number): string {
    const months = this.monthsForYear(year);
    return months.find((m) => m.value === month)?.label ?? '';
  }

  /**
   * Standard "[day] [month] [year]" gematriya string, e.g. `'כ״ג אייר תשפ״ו'`.
   */
  formatHebrewDate(day: number, month: number, year: number): string {
    return `${this.dayGematriya(day)} ${this.monthLabel(month, year)} ${this.yearGematriya(year)}`;
  }

  /**
   * Returns a friendly display of the Gregorian date in the form:
   *   "יום חמישי, 14/05/2026"
   */
  formatGregorianWithDayName(date: Date): string {
    const dayName = this.dayOfWeekHebrew(date);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `יום ${dayName}, ${dd}/${mm}/${yyyy}`;
  }

  /** Converts a `Date` to a `yyyy-MM-dd` string using local time components. */
  toIso(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** Parses a `yyyy-MM-dd` string into a local `Date`. Returns `null` if invalid. */
  parseIso(iso: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) return null;
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const d = new Date(year, month - 1, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }
}
