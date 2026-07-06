import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  signal
} from '@angular/core';
import { HDate } from '@hebcal/core';

import { HebrewDateService } from '../../core/services/hebrew-date.service';

interface HebrewCalendarCell {
  day: number | null;
  selected: boolean;
  today: boolean;
}

interface HebrewCalendarView {
  year: number;
  month: number;
}

@Component({
  selector: 'app-hebrew-calendar-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './hebrew-calendar-picker.component.html',
  styleUrl: './hebrew-calendar-picker.component.scss'
})
export class HebrewCalendarPickerComponent {
  private readonly hebrew = inject(HebrewDateService);

  readonly year = model.required<number>();
  readonly month = model.required<number>();
  readonly day = model.required<number>();

  readonly ariaLabel = input('פתח לוח שנה עברי');
  readonly dialogLabel = input('בחירת תאריך');

  protected readonly open = signal(false);
  protected readonly calendarWeekdays = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'] as const;

  private readonly calendarView = signal<HebrewCalendarView>({ year: 0, month: 0 });

  protected readonly calendarCells = computed(() => this.buildCalendarCells());
  protected readonly calendarHeaderLabel = computed(() => {
    const view = this.calendarView();
    if (!view.year || !view.month) {
      return '';
    }
    return `${this.hebrew.monthLabel(view.month, view.year)} ${this.hebrew.yearGematriya(view.year)}`;
  });

  protected dayLabel(day: number): string {
    return this.hebrew.dayGematriya(day);
  }

  protected toggle(event: MouseEvent): void {
    event.stopPropagation();
    if (this.open()) {
      this.close();
      return;
    }

    this.calendarView.set({ year: this.year(), month: this.month() });
    this.open.set(true);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected prevMonth(): void {
    const view = this.calendarView();
    const prevMonth = new HDate(1, view.month, view.year).prev();
    this.calendarView.set({ year: prevMonth.getFullYear(), month: prevMonth.getMonth() });
  }

  protected nextMonth(): void {
    const view = this.calendarView();
    const daysInMonth = this.hebrew.daysInMonth(view.month, view.year);
    const nextMonth = new HDate(daysInMonth, view.month, view.year).next();
    this.calendarView.set({ year: nextMonth.getFullYear(), month: nextMonth.getMonth() });
  }

  protected selectDay(day: number): void {
    const view = this.calendarView();
    this.year.set(view.year);
    this.month.set(view.month);
    this.day.set(day);
    this.close();
  }

  private buildCalendarCells(): HebrewCalendarCell[] {
    const view = this.calendarView();
    const { year, month } = view;
    if (!year || !month) {
      return [];
    }

    const selectedYear = this.year();
    const selectedMonth = this.month();
    const selectedDay = this.day();
    const today = this.hebrew.toHebrewParts(new Date());

    const firstDayOfWeek = new HDate(1, month, year).getDay();
    const daysInMonth = this.hebrew.daysInMonth(month, year);
    const cells: HebrewCalendarCell[] = [];

    for (let i = 0; i < firstDayOfWeek; i++) {
      cells.push({ day: null, selected: false, today: false });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({
        day: d,
        selected: d === selectedDay && month === selectedMonth && year === selectedYear,
        today: d === today.day && month === today.month && year === today.year
      });
    }

    return cells;
  }
}
