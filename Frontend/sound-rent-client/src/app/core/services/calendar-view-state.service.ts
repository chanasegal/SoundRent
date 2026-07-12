import { Injectable, signal } from '@angular/core';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Remembers the last date the weekly board was viewing so navigation away
 * (order form, admin pages) and back restores that week instead of today.
 */
@Injectable({ providedIn: 'root' })
export class CalendarViewStateService {
  private readonly selectedDateIsoSignal = signal<string | null>(null);

  readonly selectedDateIso = this.selectedDateIsoSignal.asReadonly();

  setSelectedDate(iso: string | null | undefined): void {
    if (!iso || typeof iso !== 'string') {
      return;
    }
    const trimmed = iso.trim();
    if (!ISO_DATE_RE.test(trimmed)) {
      return;
    }
    this.selectedDateIsoSignal.set(trimmed);
  }

  /** Query params for `/dashboard` links that preserve the viewed week. */
  dashboardQueryParams(): { date?: string } {
    const date = this.selectedDateIsoSignal();
    return date ? { date } : {};
  }
}
