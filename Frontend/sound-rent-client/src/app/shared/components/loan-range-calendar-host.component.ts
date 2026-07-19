import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { HDate } from '@hebcal/core';
import { Popover } from 'primeng/popover';

import { HebrewDateService } from '../../core/services/hebrew-date.service';

function toLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function dayKey(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
}

interface HebrewRangeCell {
  /** Hebrew day-of-month, or null for leading pad cells. */
  day: number | null;
  /** Gregorian local midnight for this Hebrew day (when day != null). */
  gregorian: Date | null;
  inRange: boolean;
  rangeStart: boolean;
  rangeEnd: boolean;
  today: boolean;
}

interface HebrewMonthView {
  year: number;
  month: number;
}

/**
 * Shared host for the returns-table loan-range overview calendar.
 * Renders a Hebrew (Jewish) month grid with the loan→return span highlighted.
 * Place once per page; call `open(event, lentAt, returnedAt)` from each row button.
 */
@Component({
  selector: 'app-loan-range-calendar-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Popover],
  template: `
    <p-popover #rangePopover [appendTo]="'body'" styleClass="loan-range-calendar-popover">
      <div class="range-cal-panel" dir="rtl">
        <p class="range-cal-panel__title">טווח ימי ההשאלה</p>
        @if (hebrewRangeLabel()) {
          <p class="range-cal-panel__subtitle">{{ hebrewRangeLabel() }}</p>
        }

        <div class="range-cal-panel__header">
          <button
            type="button"
            class="range-cal-panel__nav"
            (click)="prevMonth()"
            aria-label="חודש קודם"
          >
            ‹
          </button>
          <span class="range-cal-panel__month">{{ monthHeaderLabel() }}</span>
          <button
            type="button"
            class="range-cal-panel__nav"
            (click)="nextMonth()"
            aria-label="חודש הבא"
          >
            ›
          </button>
        </div>

        <div class="range-cal-panel__weekdays" aria-hidden="true">
          @for (weekday of weekdays; track weekday) {
            <span class="range-cal-panel__weekday">{{ weekday }}</span>
          }
        </div>

        <div class="range-cal-panel__grid" role="grid" aria-label="לוח שנה עברי">
          @for (cell of calendarCells(); track $index) {
            @if (cell.day !== null) {
              <div
                class="range-cal-panel__day"
                [class.range-cal-panel__day--in-range]="cell.inRange"
                [class.range-cal-panel__day--start]="cell.rangeStart"
                [class.range-cal-panel__day--end]="cell.rangeEnd"
                [class.range-cal-panel__day--today]="cell.today"
                [attr.title]="cellTitle(cell)"
                role="gridcell"
              >
                {{ dayLabel(cell.day) }}
              </div>
            } @else {
              <span class="range-cal-panel__pad" aria-hidden="true"></span>
            }
          }
        </div>

        @if (spansMultipleMonths()) {
          <p class="range-cal-panel__hint">הטווח חוצה חודשים — דפדפו בין החודשים לראות את כל הימים</p>
        }
      </div>
    </p-popover>
  `,
  styles: `
    :host {
      display: contents;
    }

    .range-cal-panel {
      padding: 0.2rem 0.15rem 0.35rem;
      min-width: 16.5rem;
      box-sizing: border-box;
    }

    .range-cal-panel__title {
      margin: 0;
      font-size: 0.8rem;
      font-weight: 800;
      color: #002244;
      text-align: center;
    }

    .range-cal-panel__subtitle {
      margin: 0.35rem 0 0.65rem;
      font-size: 0.75rem;
      font-weight: 700;
      color: #1d4ed8;
      text-align: center;
      line-height: 1.35;
    }

    .range-cal-panel__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.45rem;
    }

    .range-cal-panel__month {
      flex: 1 1 auto;
      text-align: center;
      font-size: 0.875rem;
      font-weight: 800;
      color: #002244;
    }

    .range-cal-panel__nav {
      flex: 0 0 1.75rem;
      width: 1.75rem;
      height: 1.75rem;
      margin: 0;
      padding: 0;
      border: 1px solid #e2e8f0;
      border-radius: 0.375rem;
      background: #f8fafc;
      font-size: 1rem;
      line-height: 1;
      color: #334155;
      cursor: pointer;

      &:hover {
        background: #f1f5f9;
      }
    }

    .range-cal-panel__weekdays {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 0.15rem;
      margin-bottom: 0.25rem;
    }

    .range-cal-panel__weekday {
      text-align: center;
      font-size: 0.6875rem;
      font-weight: 700;
      color: #64748b;
    }

    .range-cal-panel__grid {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 0.15rem;
    }

    .range-cal-panel__pad {
      display: block;
      aspect-ratio: 1;
    }

    .range-cal-panel__day {
      display: flex;
      align-items: center;
      justify-content: center;
      aspect-ratio: 1;
      border: 1px solid transparent;
      border-radius: 0.375rem;
      font-size: 0.75rem;
      font-weight: 700;
      color: #0f172a;
      user-select: none;

      &--today:not(.range-cal-panel__day--in-range) {
        border-color: #bae6fd;
        background: #f0f9ff;
      }

      &--in-range {
        background: #dbeafe;
        color: #1e3a8a;
      }

      &--start,
      &--end {
        background: #1d4ed8;
        border-color: #1d4ed8;
        color: #fff;
      }
    }

    .range-cal-panel__hint {
      margin: 0.55rem 0 0;
      font-size: 0.68rem;
      font-weight: 600;
      color: #64748b;
      text-align: center;
      line-height: 1.35;
    }
  `
})
export class LoanRangeCalendarHostComponent {
  private readonly hebrew = inject(HebrewDateService);
  private readonly popover = viewChild.required<Popover>('rangePopover');

  protected readonly weekdays = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'] as const;

  private readonly rangeValue = signal<Date[] | null>(null);
  private readonly calendarView = signal<HebrewMonthView>({ year: 0, month: 0 });

  protected readonly hebrewRangeLabel = computed(() => {
    const range = this.rangeValue();
    if (!range || range.length < 2) {
      return '';
    }
    return `מ-${this.hebrew.toHebrew(range[0])} עד ${this.hebrew.toHebrew(range[1])}`;
  });

  protected readonly monthHeaderLabel = computed(() => {
    const view = this.calendarView();
    if (!view.year || !view.month) {
      return '';
    }
    return `${this.hebrew.monthLabel(view.month, view.year)} ${this.hebrew.yearGematriya(view.year)}`;
  });

  protected readonly spansMultipleMonths = computed(() => {
    const range = this.rangeValue();
    if (!range || range.length < 2) {
      return false;
    }
    const start = this.hebrew.toHebrewParts(range[0]);
    const end = this.hebrew.toHebrewParts(range[1]);
    return start.month !== end.month || start.year !== end.year;
  });

  /**
   * Every Gregorian day-key in the loan→return span, built by iterating one
   * calendar day at a time. EVERY weekday is included — Fridays, Saturdays and
   * holidays alike — because the item was physically held on each of those days.
   * No weekday/Friday exclusion is applied to the visual highlight (Shabbat /
   * Yom Tov are only excluded from *billing*, not from the display range).
   */
  private readonly highlightedKeys = computed((): Set<number> => {
    const keys = new Set<number>();
    const range = this.rangeValue();
    if (!range || range.length < 2) {
      return keys;
    }

    let cursor = toLocalDay(range[0]);
    const end = toLocalDay(range[1]);
    while (cursor.getTime() <= end.getTime()) {
      // Add the day unconditionally — Fridays are treated like any other weekday.
      keys.add(dayKey(cursor));
      cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
    }
    return keys;
  });

  protected readonly calendarCells = computed((): HebrewRangeCell[] => {
    const view = this.calendarView();
    const range = this.rangeValue();
    if (!view.year || !view.month || !range || range.length < 2) {
      return [];
    }

    const highlighted = this.highlightedKeys();
    const startKey = dayKey(toLocalDay(range[0]));
    const endKey = dayKey(toLocalDay(range[1]));
    const todayParts = this.hebrew.toHebrewParts(new Date());
    const firstWeekday = new HDate(1, view.month, view.year).getDay();
    const daysInMonth = this.hebrew.daysInMonth(view.month, view.year);
    const cells: HebrewRangeCell[] = [];

    for (let i = 0; i < firstWeekday; i++) {
      cells.push({
        day: null,
        gregorian: null,
        inRange: false,
        rangeStart: false,
        rangeEnd: false,
        today: false
      });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const gregorian = toLocalDay(this.hebrew.toGregorian(view.year, view.month, d));
      const key = dayKey(gregorian);
      // Highlight strictly from the iterated span set — includes Fridays.
      const inRange = highlighted.has(key);
      cells.push({
        day: d,
        gregorian,
        inRange,
        rangeStart: key === startKey,
        rangeEnd: key === endKey,
        today:
          d === todayParts.day &&
          view.month === todayParts.month &&
          view.year === todayParts.year
      });
    }

    return cells;
  });

  protected dayLabel(day: number): string {
    return this.hebrew.dayGematriya(day);
  }

  protected cellTitle(cell: HebrewRangeCell): string {
    if (!cell.gregorian || cell.day == null) {
      return '';
    }
    const view = this.calendarView();
    return this.hebrew.formatHebrewDate(cell.day, view.month, view.year);
  }

  protected prevMonth(): void {
    const view = this.calendarView();
    if (!view.year || !view.month) {
      return;
    }
    const prev = new HDate(1, view.month, view.year).prev();
    this.calendarView.set({ year: prev.getFullYear(), month: prev.getMonth() });
  }

  protected nextMonth(): void {
    const view = this.calendarView();
    if (!view.year || !view.month) {
      return;
    }
    const daysInMonth = this.hebrew.daysInMonth(view.month, view.year);
    const next = new HDate(daysInMonth, view.month, view.year).next();
    this.calendarView.set({ year: next.getFullYear(), month: next.getMonth() });
  }

  /** Opens (or retargets/closes) the Hebrew range calendar for the given loan/return dates. */
  open(event: Event, lentAt: Date, returnedAt: Date): void {
    event.preventDefault();
    event.stopPropagation();

    const popover = this.popover();
    if (popover.overlayVisible && !popover.hasTargetChanged(event, undefined)) {
      popover.toggle(event);
      return;
    }

    const start = toLocalDay(lentAt);
    const end = toLocalDay(returnedAt);
    const ordered = start.getTime() <= end.getTime() ? [start, end] : [end, start];
    this.rangeValue.set(ordered);

    const startHeb = this.hebrew.toHebrewParts(ordered[0]);
    this.calendarView.set({ year: startHeb.year, month: startHeb.month });

    setTimeout(() => popover.toggle(event), 0);
  }
}
