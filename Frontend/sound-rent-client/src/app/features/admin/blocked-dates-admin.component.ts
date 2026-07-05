import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';

import { BlockedDateDto } from '../../core/models/blocked-date.model';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService, HebrewMonthOption } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';

type HebrewEndpoint = 'start' | 'end';

@Component({
  selector: 'app-blocked-dates-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './blocked-dates-admin.component.html',
  styleUrl: './blocked-dates-admin.component.scss'
})
export class BlockedDatesAdminComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly toast = inject(ToastService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  private readonly initialHebrew = this.hebrew.toHebrewParts(new Date());

  protected readonly rows = signal<BlockedDateDto[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly deletingId = signal<number | null>(null);
  protected readonly editingId = signal<number | null>(null);

  private readonly startHebrewYearSig = signal(this.initialHebrew.year);
  private readonly startHebrewMonthSig = signal(this.initialHebrew.month);
  private readonly endHebrewYearSig = signal(this.initialHebrew.year);
  private readonly endHebrewMonthSig = signal(this.initialHebrew.month);
  private readonly extraYearsSig = signal<number[]>([]);

  protected readonly startYearOptions = computed(() => this.yearOptionsForEndpoint('start'));
  protected readonly endYearOptions = computed(() => this.yearOptionsForEndpoint('end'));
  protected readonly startMonthOptions = computed(() => this.monthOptionsForEndpoint('start'));
  protected readonly endMonthOptions = computed(() => this.monthOptionsForEndpoint('end'));
  protected readonly startDayOptions = computed(() => this.dayOptionsForEndpoint('start'));
  protected readonly endDayOptions = computed(() => this.dayOptionsForEndpoint('end'));

  protected readonly blockForm = this.buildBlockForm();

  ngOnInit(): void {
    this.wireHebrewRangeSync();
    this.refresh();
  }

  protected dayLabel(day: number): string {
    return this.hebrew.dayGematriya(day);
  }

  protected yearLabel(year: number): string {
    return this.hebrew.yearGematriya(year);
  }

  protected refresh(): void {
    this.loading.set(true);
    this.data
      .getBlockedDates()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (list) => this.rows.set(list)
      });
  }

  protected submitBlock(): void {
    if (this.blockForm.invalid) {
      this.blockForm.markAllAsTouched();
      this.toast.error('אנא מלאו את תאריכי ההתחלה והסיום');
      return;
    }

    const startDate = this.hebrewPartsToIso('start');
    const endDate = this.hebrewPartsToIso('end');
    if (!startDate || !endDate) {
      this.toast.error('תאריך לא תקין');
      return;
    }
    if (endDate < startDate) {
      this.toast.error('תאריך הסיום חייב להיות באותו יום או אחרי תאריך ההתחלה');
      return;
    }

    const v = this.blockForm.getRawValue();
    const payload = {
      startDate,
      endDate,
      reason: ((v.reason as string) ?? '').trim() || null
    };

    const editId = this.editingId();
    this.saving.set(true);
    const request$ =
      editId !== null
        ? this.data.updateBlockedDate(editId, payload)
        : this.data.createBlockedDate(payload);

    request$.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: (saved) => {
        if (saved === null) {
          return;
        }
        this.toast.success(editId !== null ? 'החסימה עודכנה' : 'התאריכים נחסמו בהצלחה');
        this.cancelEdit();
        this.refresh();
      }
    });
  }

  protected startEdit(row: BlockedDateDto): void {
    this.editingId.set(row.id);
    this.patchHebrewFromIso('start', row.startDate);
    this.patchHebrewFromIso('end', row.endDate);
    this.blockForm.patchValue({ reason: row.reason ?? '' }, { emitEvent: false });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.resetFormToToday();
  }

  protected deleteRow(row: BlockedDateDto): void {
    const label = this.formatRangeHebrew(row);
    if (!confirm(`להסיר את החסימה ${label}?`)) {
      return;
    }

    this.deletingId.set(row.id);
    this.data
      .deleteBlockedDate(row.id)
      .pipe(finalize(() => this.deletingId.set(null)))
      .subscribe({
        next: (ok) => {
          if (!ok) {
            return;
          }
          if (this.editingId() === row.id) {
            this.cancelEdit();
          }
          this.rows.update((list) => list.filter((r) => r.id !== row.id));
          this.toast.success('החסימה הוסרה');
        }
      });
  }

  protected formatRangeHebrew(row: BlockedDateDto): string {
    const startParts = this.hebrew.isoToHebrewParts(row.startDate);
    const endParts = this.hebrew.isoToHebrewParts(row.endDate);
    if (!startParts || !endParts) {
      return row.startDate;
    }

    const startLabel = this.hebrew.formatHebrewDate(startParts.day, startParts.month, startParts.year);
    if (row.startDate === row.endDate) {
      return startLabel;
    }

    const endLabel = this.hebrew.formatHebrewDate(endParts.day, endParts.month, endParts.year);
    return `${startLabel} – ${endLabel}`;
  }

  protected formatRangeGregorian(row: BlockedDateDto): string {
    const start = this.hebrew.parseIso(row.startDate);
    const end = this.hebrew.parseIso(row.endDate);
    if (!start || !end) {
      return '';
    }
    if (row.startDate === row.endDate) {
      return this.hebrew.formatGregorianWithDayName(start);
    }
    return `${this.hebrew.formatGregorianWithDayName(start)} – ${this.hebrew.formatGregorianWithDayName(end)}`;
  }

  private buildBlockForm() {
    const parts = this.hebrew.toHebrewParts(new Date());
    return this.fb.group({
      startHebrewYear: [parts.year, Validators.required],
      startHebrewMonth: [parts.month, Validators.required],
      startHebrewDay: [parts.day, Validators.required],
      endHebrewYear: [parts.year, Validators.required],
      endHebrewMonth: [parts.month, Validators.required],
      endHebrewDay: [parts.day, Validators.required],
      reason: ['', Validators.maxLength(500)]
    });
  }

  private wireHebrewRangeSync(): void {
    this.wireHebrewEndpointSync('start');
    this.wireHebrewEndpointSync('end');
  }

  private wireHebrewEndpointSync(endpoint: HebrewEndpoint): void {
    const yearCtrl = this.blockForm.controls[`${endpoint}HebrewYear`];
    const monthCtrl = this.blockForm.controls[`${endpoint}HebrewMonth`];
    const dayCtrl = this.blockForm.controls[`${endpoint}HebrewDay`];

    this.setEndpointHebrewSignals(endpoint, Number(yearCtrl.value), Number(monthCtrl.value));
    this.ensureYearInOptions(Number(yearCtrl.value));

    yearCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((y) => {
      this.setEndpointHebrewSignals(endpoint, Number(y), Number(monthCtrl.value));
      this.ensureYearInOptions(Number(y));
      this.normalizeHebrewSelection(endpoint);
    });

    monthCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((m) => {
      this.setEndpointHebrewSignals(endpoint, Number(yearCtrl.value), Number(m));
      this.normalizeHebrewSelection(endpoint);
    });

    dayCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.normalizeHebrewSelection(endpoint);
    });
  }

  private setEndpointHebrewSignals(endpoint: HebrewEndpoint, year: number, month: number): void {
    if (endpoint === 'start') {
      this.startHebrewYearSig.set(year);
      this.startHebrewMonthSig.set(month);
    } else {
      this.endHebrewYearSig.set(year);
      this.endHebrewMonthSig.set(month);
    }
  }

  private normalizeHebrewSelection(endpoint: HebrewEndpoint): void {
    const yearCtrl = this.blockForm.controls[`${endpoint}HebrewYear`];
    const monthCtrl = this.blockForm.controls[`${endpoint}HebrewMonth`];
    const dayCtrl = this.blockForm.controls[`${endpoint}HebrewDay`];

    let year = Number(yearCtrl.value);
    let month = Number(monthCtrl.value);
    let day = Number(dayCtrl.value);

    if (!year || !month || !day) {
      return;
    }

    if (!this.hebrew.isLeapYear(year) && month === 13) {
      month = 12;
      monthCtrl.setValue(month, { emitEvent: false });
      this.setEndpointHebrewSignals(endpoint, year, month);
    }

    const maxDay = this.hebrew.daysInMonth(month, year);
    if (day > maxDay) {
      dayCtrl.setValue(maxDay, { emitEvent: false });
    }
  }

  private patchHebrewFromIso(endpoint: HebrewEndpoint, iso: string): void {
    const parts = this.hebrew.isoToHebrewParts(iso);
    if (!parts) {
      return;
    }

    this.ensureYearInOptions(parts.year);
    this.blockForm.patchValue(
      {
        [`${endpoint}HebrewYear`]: parts.year,
        [`${endpoint}HebrewMonth`]: parts.month,
        [`${endpoint}HebrewDay`]: parts.day
      },
      { emitEvent: false }
    );
    this.setEndpointHebrewSignals(endpoint, parts.year, parts.month);
  }

  private resetFormToToday(): void {
    const parts = this.hebrew.toHebrewParts(new Date());
    this.blockForm.reset({
      startHebrewYear: parts.year,
      startHebrewMonth: parts.month,
      startHebrewDay: parts.day,
      endHebrewYear: parts.year,
      endHebrewMonth: parts.month,
      endHebrewDay: parts.day,
      reason: ''
    });
    this.startHebrewYearSig.set(parts.year);
    this.startHebrewMonthSig.set(parts.month);
    this.endHebrewYearSig.set(parts.year);
    this.endHebrewMonthSig.set(parts.month);
  }

  private hebrewPartsToIso(endpoint: HebrewEndpoint): string | null {
    const year = Number(this.blockForm.controls[`${endpoint}HebrewYear`].value);
    const month = Number(this.blockForm.controls[`${endpoint}HebrewMonth`].value);
    const day = Number(this.blockForm.controls[`${endpoint}HebrewDay`].value);
    if (!year || !month || !day) {
      return null;
    }
    return this.hebrew.toIso(this.hebrew.toGregorian(year, month, day));
  }

  private yearOptionsForEndpoint(endpoint: HebrewEndpoint): number[] {
    const currentYear = this.hebrew.toHebrewParts(new Date()).year;
    const base = new Set<number>();
    for (let y = currentYear - 2; y <= currentYear + 10; y++) {
      base.add(y);
    }
    for (const y of this.extraYearsSig()) {
      base.add(y);
    }
    return [...base].sort((a, b) => a - b);
  }

  private monthOptionsForEndpoint(endpoint: HebrewEndpoint): HebrewMonthOption[] {
    const year = endpoint === 'start' ? this.startHebrewYearSig() : this.endHebrewYearSig();
    if (!year) {
      return [];
    }
    return this.hebrew.monthsForYear(year);
  }

  private dayOptionsForEndpoint(endpoint: HebrewEndpoint): number[] {
    const year = endpoint === 'start' ? this.startHebrewYearSig() : this.endHebrewYearSig();
    const month = endpoint === 'start' ? this.startHebrewMonthSig() : this.endHebrewMonthSig();
    if (!year || !month) {
      return [];
    }
    const max = this.hebrew.daysInMonth(month, year);
    return Array.from({ length: max }, (_, i) => i + 1);
  }

  private ensureYearInOptions(year: number): void {
    if (!year) {
      return;
    }
    const inStart = this.startYearOptions().includes(year);
    const inEnd = this.endYearOptions().includes(year);
    if (!inStart && !inEnd) {
      this.extraYearsSig.update((arr) => (arr.includes(year) ? arr : [...arr, year]));
    }
  }
}
