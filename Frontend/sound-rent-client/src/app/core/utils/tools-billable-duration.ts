import { HDate, HebrewCalendar, flags } from '@hebcal/core';

/** True when the local calendar day is Saturday or an Israeli Yom Tov (CHAG). */
export function isShabbatOrChag(date: Date): boolean {
  if (date.getDay() === 6) {
    return true;
  }

  const events = HebrewCalendar.getHolidaysOnDate(new HDate(date), true);
  if (!events?.length) {
    return false;
  }

  return events.some((ev) => (ev.getFlags() & flags.CHAG) !== 0);
}

function startOfNextLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

/**
 * Billable duration in milliseconds between `start` and `end`,
 * entirely excluding Saturdays and Jewish holidays (Chagim).
 */
export function billableDurationMs(start: Date, end: Date): number {
  if (!(start instanceof Date) || !(end instanceof Date) || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }
  if (end <= start) {
    return 0;
  }

  let total = 0;
  let cursor = new Date(start.getTime());

  while (cursor < end) {
    const segmentEnd = startOfNextLocalDay(cursor);
    const cappedEnd = segmentEnd < end ? segmentEnd : end;
    if (!isShabbatOrChag(cursor)) {
      total += cappedEnd.getTime() - cursor.getTime();
    }
    cursor = cappedEnd;
  }

  return total;
}

export interface BillableDurationParts {
  days: number;
  hours: number;
  minutes: number;
  totalMs: number;
}

export function toBillableParts(start: Date, end: Date): BillableDurationParts {
  const totalMs = billableDurationMs(start, end);
  const totalMinutes = Math.floor(totalMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  return { days, hours, minutes, totalMs };
}

export function formatBillableDuration(parts: BillableDurationParts): string {
  const chunks: string[] = [];
  if (parts.days > 0) {
    chunks.push(`${parts.days} ימים`);
  }
  if (parts.hours > 0 || parts.days > 0) {
    chunks.push(`${parts.hours} שעות`);
  }
  chunks.push(`${parts.minutes} דקות`);
  return chunks.join(' · ');
}
