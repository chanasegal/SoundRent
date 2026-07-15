import { isShabbatOrChag } from './tools-billable-duration';

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/**
 * Count whole local calendar days from `start` (inclusive) to `end` (exclusive),
 * skipping Saturdays and Israeli Yom Tov (same calendar rules as Tools billable time).
 */
export function libraryBillableDays(start: Date, end: Date): number {
  if (!(start instanceof Date) || !(end instanceof Date) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }

  let cursor = startOfLocalDay(start);
  const endDay = startOfLocalDay(end);
  if (endDay <= cursor) {
    return 0;
  }

  let days = 0;
  while (cursor < endDay) {
    if (!isShabbatOrChag(cursor)) {
      days += 1;
    }
    cursor = addLocalDays(cursor, 1);
  }
  return days;
}

/** Hebrew day-count label: יום אחד / יומיים / N ימים. */
export function formatLibraryDayCount(days: number): string {
  const n = Math.max(0, Math.floor(days));
  if (n === 0) {
    return 'היום';
  }
  if (n === 1) {
    return 'יום אחד';
  }
  if (n === 2) {
    return 'יומיים';
  }
  return `${n} ימים`;
}

/**
 * Duration shown on Library loan/return tables.
 * Overdue rows: "עבר זמנו - 5 ימים".
 */
export function formatLibraryDuration(days: number, overdue: boolean): string {
  const label = formatLibraryDayCount(days);
  return overdue ? `עבר זמנו - ${label}` : label;
}

/** End-of-day for due-date comparisons (due today = not overdue until tomorrow). */
export function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function addDaysToDate(date: Date, days: number): Date {
  return addLocalDays(startOfLocalDay(date), days);
}
