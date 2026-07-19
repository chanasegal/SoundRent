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

/** True when the local calendar day is Chol HaMoed (intermediate holiday day). */
export function isCholHamoed(date: Date): boolean {
  const events = HebrewCalendar.getHolidaysOnDate(new HDate(date), true);
  if (!events?.length) {
    return false;
  }
  return events.some((ev) => (ev.getFlags() & flags.CHOL_HAMOED) !== 0);
}

/**
 * Single source of truth for excluded days: a day is NON-billable when it is
 * Shabbat, a Yom Tov (Chag), or Chol HaMoed. Used by the billable-days loop,
 * the "total duration" count, and the calendar's skipped/counted marking so all
 * three always agree.
 */
export function isNonBillableDay(date: Date): boolean {
  return isShabbatOrChag(date) || isCholHamoed(date);
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

/* -------------------------------------------------------------------------- */
/*  Calendar-day span — the single source of truth shared by the duration      */
/*  text and the visual calendar highlight, so they can never disagree.        */
/* -------------------------------------------------------------------------- */

/** Local-midnight UTC key giving each calendar day a stable, TZ-agnostic id. */
export function localDayKey(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Inclusive list of local-midnight `Date`s for every calendar day touched by
 * the [start, end] span. Both the start and end calendar days are included, so
 * a loan that crosses midnight yields two days (e.g. Sun 19:00 → Mon 00:30 →
 * two days). Time components and UTC/local offsets are ignored.
 */
export function calendarDays(start: Date, end: Date): Date[] {
  if (
    !(start instanceof Date) ||
    !(end instanceof Date) ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return [];
  }

  const [from, to] = start.getTime() <= end.getTime() ? [start, end] : [end, start];
  let cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  const days: Date[] = [];
  while (cursor.getTime() <= last.getTime()) {
    days.push(cursor);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }
  return days;
}

/** Inclusive list of calendar-day keys touched by the [start, end] span. */
export function calendarDayKeys(start: Date, end: Date): number[] {
  return calendarDays(start, end).map(localDayKey);
}

/** Number of calendar days the [start, end] span touches (inclusive, >= 1). */
export function calendarDaySpan(start: Date, end: Date): number {
  return calendarDays(start, end).length;
}

/**
 * Number of *billable* calendar days in the span — the inclusive calendar days
 * minus any that are non-billable (Shabbat / Yom Tov / Chol HaMoed).
 */
export function billableCalendarDaySpan(start: Date, end: Date): number {
  return calendarDays(start, end).filter((day) => !isNonBillableDay(day)).length;
}

/**
 * Human duration for the returns "total duration" column, kept in sync with the
 * calendar highlight. Excluded days (Shabbat / Yom Tov / Chol HaMoed) never
 * count toward the day total:
 * - same calendar day  → elapsed hours & minutes (e.g. "9 שעות ו-30 דקות")
 * - spans 2+ calendar days → the *billable* calendar-day count (e.g. "2 ימים")
 */
export function formatCalendarDuration(start: Date, end: Date): string {
  if (
    !(start instanceof Date) ||
    !(end instanceof Date) ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime())
  ) {
    return '—';
  }

  // Whether the loan physically crosses midnight decides the display mode…
  if (calendarDaySpan(start, end) > 1) {
    // …but the number shown excludes non-billable days.
    const billableDays = billableCalendarDaySpan(start, end);
    return billableDays === 1 ? 'יום אחד' : `${billableDays} ימים`;
  }

  const totalMinutes = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours} שעות ו-${minutes} דקות`;
  }
  if (hours > 0) {
    return `${hours} שעות`;
  }
  return `${minutes} דקות`;
}

/* -------------------------------------------------------------------------- */
/*  Debug helpers — day-by-day billable-day breakdown                          */
/* -------------------------------------------------------------------------- */

function toIsoLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Classifies a single local day as billable or not, with a human reason. */
function classifyDay(date: Date): { billable: boolean; reason: string } {
  if (date.getDay() === 6) {
    return { billable: false, reason: 'Shabbat' };
  }
  const events = HebrewCalendar.getHolidaysOnDate(new HDate(date), true) || [];
  const chag = events.filter((ev) => (ev.getFlags() & flags.CHAG) !== 0);
  if (chag.length) {
    return { billable: false, reason: `Holiday: ${chag.map((e) => e.getDesc()).join(', ')}` };
  }
  const cholHamoed = events.filter((ev) => (ev.getFlags() & flags.CHOL_HAMOED) !== 0);
  if (cholHamoed.length) {
    return {
      billable: false,
      reason: `Chol HaMoed: ${cholHamoed.map((e) => e.getDesc()).join(', ')}`
    };
  }
  return { billable: true, reason: 'Regular Day' };
}

export interface BillableDayStep {
  index: number;
  date: string;
  weekday: string;
  status: 'Billable' | 'Excluded';
  reason: string;
}

export interface BillableDaysBreakdown {
  start: string;
  end: string;
  endExclusive: true;
  steps: BillableDayStep[];
  total: number;
}

/**
 * Produces the exact same day-by-day walk as `libraryBillableDays` /
 * `calculateBillableDays` (start day inclusive → return day EXCLUSIVE), but
 * returns each step so the calculation can be inspected.
 */
export function describeBillableDays(start: Date, end: Date): BillableDaysBreakdown {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const steps: BillableDayStep[] = [];
  let total = 0;
  let cursor = new Date(startDay);
  let index = 0;

  while (cursor < endDay) {
    const { billable, reason } = classifyDay(cursor);
    if (billable) {
      total += 1;
    }
    steps.push({
      index: ++index,
      date: toIsoLocal(cursor),
      weekday: cursor.toLocaleDateString('he-IL', { weekday: 'long' }),
      status: billable ? 'Billable' : 'Excluded',
      reason
    });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }

  return { start: toIsoLocal(startDay), end: toIsoLocal(endDay), endExclusive: true, steps, total };
}

/**
 * Debug helper: prints the day-by-day billable breakdown to the console and
 * returns the structured result. The return day itself is NOT counted (the
 * loop is [loanDate, returnDate) — end-exclusive).
 */
export function logBillableDays(start: Date, end: Date): BillableDaysBreakdown {
  const b = describeBillableDays(start, end);
  console.log('%c⟶ Billable-days breakdown', 'font-weight:bold;color:#1d4ed8');
  console.log(`Start (loan day):   ${b.start}`);
  console.log(`End  (return day):  ${b.end}   ← EXCLUSIVE, the return day itself is not counted`);
  console.table(
    b.steps.map((s) => ({
      '#': s.index,
      Date: s.date,
      Day: s.weekday,
      Status: s.status,
      Reason: s.reason
    }))
  );
  console.log(`%cTotal billable days: ${b.total}`, 'font-weight:bold');
  return b;
}
