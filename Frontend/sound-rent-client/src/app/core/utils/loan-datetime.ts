/**
 * Safe loan/return instant parsing for the Returns views.
 *
 * Goals:
 * - Preserve hours/minutes from full ISO timestamps (no forced 00:00).
 * - Parse date-only `YYYY-MM-DD` as a local civil day (no UTC midnight shift).
 * - Reject epoch / DateTime.MinValue / absurd years that corrupt Hebrew dates
 *   and inflate duration into tens of thousands of days.
 */

/** Inclusive lower bound for a plausible SoundRent loan year. */
const MIN_PLAUSIBLE_YEAR = 2000;
/** Inclusive upper bound for a plausible SoundRent loan year. */
const MAX_PLAUSIBLE_YEAR = 2100;

export function isPlausibleLoanDate(date: Date | null | undefined): date is Date {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return false;
  }
  const year = date.getFullYear();
  return year >= MIN_PLAUSIBLE_YEAR && year <= MAX_PLAUSIBLE_YEAR;
}

/** Parse a full ISO timestamp, preserving hours/minutes in local time. */
export function parseLoanTimestamp(iso: string | null | undefined): Date | null {
  const raw = (iso ?? '').trim();
  if (!raw || /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    // Date-only strings must go through parseLoanIsoDay — do not invent UTC midnight.
    return null;
  }
  const date = new Date(raw);
  return isPlausibleLoanDate(date) ? date : null;
}

/**
 * Parse `yyyy-MM-dd` (or the date prefix of a longer ISO) into a local midnight
 * Date so timezone offsets cannot shift the civil day.
 */
export function parseLoanIsoDay(iso: string | null | undefined): Date | null {
  const raw = (iso ?? '').trim();
  if (!raw) {
    return null;
  }
  const dayPart = raw.length >= 10 ? raw.slice(0, 10) : raw;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayPart)) {
    return null;
  }
  const [y, m, d] = dayPart.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return isPlausibleLoanDate(date) ? date : null;
}

/**
 * First plausible instant among candidates (timestamps preferred by callers
 * that pass them first). Returns null when nothing is usable — never epoch.
 */
export function resolveLoanInstant(
  ...candidates: Array<string | Date | null | undefined>
): Date | null {
  for (const candidate of candidates) {
    if (candidate instanceof Date) {
      if (isPlausibleLoanDate(candidate)) {
        return candidate;
      }
      continue;
    }
    const fromTs = parseLoanTimestamp(candidate);
    if (fromTs) {
      return fromTs;
    }
    const fromDay = parseLoanIsoDay(candidate);
    if (fromDay) {
      return fromDay;
    }
  }
  return null;
}

/** Local `YYYY-MM-DD` from local Y/M/D components (no UTC day-shift). */
export function toLocalIsoDay(date: Date): string {
  if (!isPlausibleLoanDate(date)) {
    return '';
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
