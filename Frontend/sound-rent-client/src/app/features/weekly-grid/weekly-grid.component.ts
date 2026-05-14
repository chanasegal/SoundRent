import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { HDate, months } from '@hebcal/core';
import { forkJoin, finalize } from 'rxjs';

import {
  DEPOSIT_TYPE_LABELS,
  EQUIPMENT_TYPE_LABELS,
  EQUIPMENT_TYPE_ORDER,
  EquipmentType,
  LOANED_EQUIPMENT_LABELS,
  TIME_SLOT_LABELS,
  TimeSlot
} from '../../core/models/enums';
import { OrderDto } from '../../core/models/order.model';
import {
  bookingSlotToBaseEquipment,
  defaultBookingSlotForEquipmentType
} from '../../core/models/booking-slots';
import { EquipmentDefinitionDto } from '../../core/models/equipment-definition.model';
import { WaitlistEntryDto } from '../../core/models/waitlist.model';
import { DataService } from '../../core/services/data.service';
import { EquipmentDefinitionsStore } from '../../core/services/equipment-definitions.store';
import { EquipmentMaintenanceSyncService } from '../../core/services/equipment-maintenance-sync.service';
import { ExportService } from '../../core/services/export.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';

interface WeeklyGridColumnDef {
  id: string;
  headerLabel: string;
  /** Booking slot id (matches `Order.equipmentType`). */
  bookingSlot: string;
  /** Coarse type (extras columns). */
  baseEquipment: EquipmentType | null;
  /** Per-slot maintenance from catalog API. */
  isUnderMaintenance: boolean;
}

function gridColIdForSlot(slotId: string): string {
  return 'slot-' + slotId.replace(/[^a-zA-Z0-9-]/g, '_');
}

function gridHeaderShort(def: EquipmentDefinitionDto): string {
  const name = def.displayName.trim();
  return name.length <= 12 ? name : def.id;
}

interface GridCell {
  columnId: string;
  columnHeaderLabel: string;
  orders: OrderDto[];
  disabled: boolean;
  isMaintenance: boolean;
  bookingSlot: string;
  date: Date;
  timeSlot: TimeSlot;
}

interface GridRow {
  date: Date;
  dayLabel: string;
  hebrewDate: string;
  gregorian: string;
  isShabbat: boolean;
  morning: GridCell[] | null;
  evening: GridCell[] | null;
}

const DAY_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const GREGORIAN_MONTH_OPTIONS = [
  { value: 0, label: 'ינואר' },
  { value: 1, label: 'פברואר' },
  { value: 2, label: 'מרץ' },
  { value: 3, label: 'אפריל' },
  { value: 4, label: 'מאי' },
  { value: 5, label: 'יוני' },
  { value: 6, label: 'יולי' },
  { value: 7, label: 'אוגוסט' },
  { value: 8, label: 'ספטמבר' },
  { value: 9, label: 'אוקטובר' },
  { value: 10, label: 'נובמבר' },
  { value: 11, label: 'דצמבר' }
] as const;

const COMMON_HEBREW_MONTH_OPTIONS = [
  { value: months.NISAN, label: 'ניסן (Nisan)' },
  { value: months.IYYAR, label: 'אייר (Iyar)' },
  { value: months.SIVAN, label: 'סיוון (Sivan)' },
  { value: months.TAMUZ, label: 'תמוז (Tamuz)' },
  { value: months.AV, label: 'אב (Av)' },
  { value: months.ELUL, label: 'אלול (Elul)' },
  { value: months.TISHREI, label: 'תשרי (Tishrei)' },
  { value: months.CHESHVAN, label: 'חשוון (Cheshvan)' },
  { value: months.KISLEV, label: 'כסלו (Kislev)' },
  { value: months.TEVET, label: 'טבת (Tevet)' },
  { value: months.SHVAT, label: 'שבט (Shvat)' },
  { value: months.ADAR_I, label: 'אדר (Adar)' }
] as const;

const LEAP_HEBREW_MONTH_OPTIONS = [
  ...COMMON_HEBREW_MONTH_OPTIONS.slice(0, 11),
  { value: months.ADAR_I, label: "אדר א׳ (Adar I)" },
  { value: months.ADAR_II, label: "אדר ב׳ (Adar II)" }
] as const;

@Component({
  selector: 'app-weekly-grid',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './weekly-grid.component.html',
  styleUrl: './weekly-grid.component.scss'
})
export class WeeklyGridComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly exportSvc = inject(ExportService);
  private readonly equipmentSlots = inject(EquipmentDefinitionsStore);
  private readonly maintenanceSync = inject(EquipmentMaintenanceSyncService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);

  protected readonly equipmentTypes = EQUIPMENT_TYPE_ORDER;
  protected readonly equipmentLabels = EQUIPMENT_TYPE_LABELS;
  protected readonly timeSlotLabels = TIME_SLOT_LABELS;

  protected readonly gridColumns = computed<WeeklyGridColumnDef[]>(() => {
    const defs = this.equipmentSlots.definitions().filter((d) => d.category === 'Speakers');
    return defs.map((d) => ({
      id: gridColIdForSlot(d.id),
      headerLabel: gridHeaderShort(d),
      bookingSlot: d.id,
      baseEquipment: bookingSlotToBaseEquipment(d.id),
      isUnderMaintenance: d.isUnderMaintenance === true
    }));
  });

  protected readonly gridDataColumnCount = computed(() => this.gridColumns().length);

  protected readonly weekStart = signal<Date>(this.startOfWeek(new Date()));
  protected readonly orders = signal<OrderDto[]>([]);
  protected readonly waitlistEntries = signal<WaitlistEntryDto[]>([]);
  protected readonly waitlistSaving = signal(false);
  protected readonly waitlistModalContext = signal<{ date: Date } | null>(null);
  protected readonly exportBackupInProgress = signal(false);

  protected readonly waitlistModalForm = this.fb.group({
    equipmentType: this.fb.nonNullable.control<EquipmentType>(EQUIPMENT_TYPE_ORDER[0], Validators.required),
    phone: ['', [Validators.required, Validators.maxLength(20)]],
    notes: ['', Validators.maxLength(1000)]
  });
  protected readonly gregorianMonths = GREGORIAN_MONTH_OPTIONS;
  protected readonly hebrewYearOptions = this.generateHebrewYears();
  protected readonly selectedGregorianMonth = signal<number>(new Date().getMonth());
  protected readonly selectedGregorianYear = signal<number>(new Date().getFullYear());
  protected readonly selectedHebrewMonth = signal<number>(new HDate(new Date()).getMonth());
  protected readonly selectedHebrewYear = signal<number>(new HDate(new Date()).getFullYear());

  protected readonly weekEnd = computed(() => this.addDays(this.weekStart(), 6));

  protected readonly gregorianRange = computed(() => {
    const fmt = (d: Date) => this.formatDate(d);
    return `${fmt(this.weekStart())} – ${fmt(this.weekEnd())}`;
  });

  protected readonly hebrewRange = computed(() =>
    this.hebrew.toHebrewRange(this.weekStart(), this.weekEnd())
  );

  protected readonly rows = computed<GridRow[]>(() => this.buildRows());

  constructor() {
    effect(() => {
      const v = this.maintenanceSync.version();
      if (v === 0) {
        return;
      }
      untracked(() => {
        this.equipmentSlots.load().subscribe();
      });
    });
  }

  ngOnInit(): void {
    const anchor = this.parseOrderDateFromQuery() ?? new Date();
    this.navigateToDate(anchor);
    this.load();
  }

  protected previousWeek(): void {
    this.navigateToDate(this.addDays(this.weekStart(), -7));
    this.load();
  }

  protected nextWeek(): void {
    this.navigateToDate(this.addDays(this.weekStart(), 7));
    this.load();
  }

  protected goToday(): void {
    this.navigateToDate(new Date());
    this.load();
  }

  protected exportAllOrdersBackupToExcel(): void {
    if (this.exportBackupInProgress()) {
      return;
    }
    this.exportBackupInProgress.set(true);
    forkJoin({
      orders: this.data.getOrdersExportAll(),
      waitlist: this.data.getWaitlistExportAll()
    })
      .pipe(finalize(() => this.exportBackupInProgress.set(false)))
      .subscribe({
        next: ({ orders, waitlist }) => {
          if (orders.length === 0 && waitlist.length === 0) {
            this.toast.show('אין הזמנות או רשומות המתנה לייצוא', 'info');
            return;
          }
          const sortedOrders = [...orders].sort((a, b) => {
            const byDate = a.orderDate.localeCompare(b.orderDate);
            return byDate !== 0 ? byDate : a.id - b.id;
          });
          const sortedWaitlist = [...waitlist].sort((a, b) => {
            const byDate = a.date.localeCompare(b.date);
            if (byDate !== 0) {
              return byDate;
            }
            const byCreated = a.createdAt.localeCompare(b.createdAt);
            return byCreated !== 0 ? byCreated : a.id - b.id;
          });
          const orderRows = sortedOrders.map((o) => this.orderToBackupExcelRow(o));
          const waitlistRows = sortedWaitlist.map((e) => this.waitlistToBackupExcelRow(e));
          const stamp = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' });
          this.exportSvc.exportMultiSheetExcel(
            [
              { sheetName: 'הזמנות', rows: orderRows },
              { sheetName: 'רשימת המתנה', rows: waitlistRows }
            ],
            `גיבוי_מלא_${stamp}`
          );
          this.toast.success('קובץ Excel הורד (הזמנות + רשימת המתנה)');
        }
      });
  }

  private orderToBackupExcelRow(o: OrderDto): Record<string, unknown> {
    return {
      מזהה: o.id,
      'מפתח ציוד': o.equipmentType,
      'תיאור ציוד': this.equipmentSlots.displayLabel(o.equipmentType),
      תאריך: o.orderDate,
      משמרת: this.timeSlotLabels[o.timeSlot],
      'שם לקוח': o.customerName ?? '',
      טלפון: o.phone,
      'טלפון 2': o.phone2 ?? '',
      כתובת: o.address ?? '',
      פיקדון: o.depositType != null ? DEPOSIT_TYPE_LABELS[o.depositType] : '',
      'שם על הפיקדון': o.depositOnName ?? '',
      'סכום תשלום': o.paymentAmount ?? '',
      שולם: o.isPaid ? 'כן' : 'לא',
      הערות: o.notes ?? '',
      'ציוד מושאל (פירוט)': this.formatLoanedEquipmentsForBackupExport(o),
      'נוצר בתאריך': o.createdAt
    };
  }

  private waitlistToBackupExcelRow(e: WaitlistEntryDto): Record<string, unknown> {
    const eqLabel = EQUIPMENT_TYPE_LABELS[e.equipmentType] ?? String(e.equipmentType);
    return {
      מזהה: e.id,
      'שם לקוח': e.customerName ?? '',
      טלפון: e.phone,
      'תאריך מבוקש': e.date,
      'סוג ציוד': eqLabel,
      הערות: e.notes ?? '',
      'נוסף בתאריך': e.createdAt
    };
  }

  private formatLoanedEquipmentsForBackupExport(o: OrderDto): string {
    const items = o.loanedEquipments ?? [];
    if (items.length === 0) {
      return '';
    }
    const parts: string[] = [];
    for (const le of items) {
      const label = LOANED_EQUIPMENT_LABELS[le.loanedEquipmentType] ?? String(le.loanedEquipmentType);
      const noteTexts = (le.notes ?? [])
        .filter((n) => (n.content ?? '').trim().length > 0)
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((n) => `#${n.ordinal + 1}: ${(n.content ?? '').trim()}`);
      const noteSuffix = noteTexts.length > 0 ? ` (${noteTexts.join('; ')})` : '';
      parts.push(`${label} ×${le.quantity}${noteSuffix}`);
    }
    return parts.join(' | ');
  }

  protected onGregorianMonthChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    this.selectedGregorianMonth.set(value);
  }

  protected onGregorianYearInput(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (!Number.isNaN(value)) {
      this.selectedGregorianYear.set(value);
    }
  }

  protected showGregorianDate(): void {
    const target = new Date(this.selectedGregorianYear(), this.selectedGregorianMonth(), 1);
    if (Number.isNaN(target.getTime())) {
      this.toast.error('שנה לועזית לא תקינה');
      return;
    }
    this.navigateToDate(target);
    this.load();
  }

  protected getHebrewMonthOptions(): ReadonlyArray<{ value: number; label: string }> {
    return this.isHebrewLeapYear(this.selectedHebrewYear())
      ? LEAP_HEBREW_MONTH_OPTIONS
      : COMMON_HEBREW_MONTH_OPTIONS;
  }

  protected onHebrewMonthChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    this.selectedHebrewMonth.set(value);
  }

  protected onHebrewYearChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    this.selectedHebrewYear.set(value);

    const monthOptions = this.getHebrewMonthOptions();
    const monthStillValid = monthOptions.some((m) => m.value === this.selectedHebrewMonth());
    if (!monthStillValid) {
      this.selectedHebrewMonth.set(monthOptions[monthOptions.length - 1].value);
    }
  }

  protected showHebrewDate(): void {
    try {
      const target = new HDate(1, this.selectedHebrewMonth(), this.selectedHebrewYear()).greg();
      this.navigateToDate(target);
      this.load();
    } catch {
      this.toast.error('תאריך עברי לא תקין');
    }
  }

  protected onEmptyCellClick(cell: GridCell): void {
    if (cell.orders.length > 0) {
      return;
    }

    if (cell.isMaintenance) {
      this.toast.error('הציוד בתיקון - לא ניתן להוסיף הזמנה חדשה');
      return;
    }

    if (cell.disabled) {
      return;
    }

    const params: Record<string, string> = {
      date: this.toIsoDate(cell.date),
      slot: cell.timeSlot
    };
    if (cell.bookingSlot) {
      params['equipment'] = cell.bookingSlot;
    }
    this.router.navigate(['/orders', 'new'], { queryParams: params });
  }

  protected openOrder(orderId: number): void {
    this.router.navigate(['/orders', orderId]);
  }

  protected addAnotherOrder(cell: GridCell): void {
    if (!cell.bookingSlot) {
      return;
    }
    if (cell.isMaintenance) {
      this.toast.error('הציוד בתיקון - לא ניתן להוסיף הזמנה חדשה');
      return;
    }

    this.router.navigate(['/orders', 'new'], {
      queryParams: {
        equipment: cell.bookingSlot,
        date: this.toIsoDate(cell.date),
        slot: cell.timeSlot,
        addAnother: '1'
      }
    });
  }

  protected cellTrackKey(cell: GridCell): string {
    return `${cell.columnId}-${cell.date.getTime()}-${cell.timeSlot}`;
  }

  /** Label for bookings / ARIA (Hebrew display for slot keys). */
  protected cellBookingLabel(cell: GridCell): string {
    return this.equipmentSlots.displayLabel(cell.bookingSlot);
  }

  protected isGenericExtraColumn(col: WeeklyGridColumnDef): boolean {
    return !!col.bookingSlot && col.baseEquipment === null;
  }

  protected isGenericExtraCell(cell: GridCell): boolean {
    return !!cell.bookingSlot && bookingSlotToBaseEquipment(cell.bookingSlot) === null;
  }

  protected dayFirstColumnRowSpan(row: GridRow): number {
    let n = 1;
    if (row.morning) {
      n++;
    }
    if (row.evening) {
      n++;
    }
    return n;
  }

  protected waitlistForDay(date: Date): WaitlistEntryDto[] {
    const iso = this.toIsoDate(date);
    return this
      .waitlistEntries()
      .filter((e) => e.date === iso)
      .sort((a, b) => {
        const eq = a.equipmentType.localeCompare(b.equipmentType);
        return eq !== 0 ? eq : a.id - b.id;
      });
  }

  protected waitlistBadgeTitle(entry: WaitlistEntryDto): string {
    const parts = [this.equipmentLabels[entry.equipmentType]];
    if (entry.notes?.trim()) {
      parts.push(entry.notes.trim());
    }
    return parts.join(' — ');
  }

  protected openAddWaitlistModal(date: Date): void {
    this.waitlistModalContext.set({ date });
    this.waitlistModalForm.reset({
      equipmentType: EQUIPMENT_TYPE_ORDER[0],
      phone: '',
      notes: ''
    });
  }

  protected closeWaitlistModal(): void {
    this.waitlistModalContext.set(null);
  }

  protected submitWaitlistModal(): void {
    const ctx = this.waitlistModalContext();
    if (!ctx) {
      return;
    }
    if (this.waitlistModalForm.invalid) {
      this.waitlistModalForm.markAllAsTouched();
      this.toast.error('אנא הזינו מספר טלפון');
      return;
    }

    const v = this.waitlistModalForm.getRawValue();
    this.waitlistSaving.set(true);
    this.data
      .createWaitlistEntry({
        phone: (v.phone ?? '').trim(),
        equipmentType: v.equipmentType as EquipmentType,
        date: this.toIsoDate(ctx.date),
        notes: ((v.notes as string) || '').trim() || null
      })
      .pipe(finalize(() => this.waitlistSaving.set(false)))
      .subscribe({
        next: (created) => {
          if (created === null) {
            return;
          }
          this.toast.success('נוסף לרשימת ההמתנה');
          this.closeWaitlistModal();
          this.load();
        }
      });
  }

  protected deleteWaitlistEntry(entry: WaitlistEntryDto, event: Event): void {
    event.stopPropagation();
    if (!confirm(`להסיר את ${entry.phone} מהרשימה?`)) {
      return;
    }
    this.data.deleteWaitlistEntry(entry.id).subscribe({
      next: (ok) => {
        if (!ok) {
          return;
        }
        this.toast.success('הוסר מרשימת ההמתנה');
        this.load();
      }
    });
  }

  protected convertWaitlistEntry(entry: WaitlistEntryDto): void {
    this.router.navigate(['/orders', 'new'], {
      queryParams: {
        equipment: defaultBookingSlotForEquipmentType(entry.equipmentType),
        date: entry.date,
        slot: TimeSlot.Morning,
        phone: entry.phone,
        notes: entry.notes?.trim() ? entry.notes : undefined
      }
    });
  }

  protected isColumnMaintenance(col: WeeklyGridColumnDef): boolean {
    return col.isUnderMaintenance;
  }

  private load(): void {
    const start = this.toIsoDate(this.weekStart());
    forkJoin({
      orders: this.data.getWeeklyOrders(start),
      waitlist: this.data.getWeeklyWaitlist(start)
    }).subscribe({
      next: ({ orders, waitlist }) => {
        this.orders.set(orders);
        this.waitlistEntries.set(waitlist);
      }
    });
  }

  private navigateToDate(date: Date): void {
    this.weekStart.set(this.startOfWeek(date));
    this.syncDateSelectors(date);
  }

  /** When opening the board from the order flow, `?date=yyyy-MM-dd` selects that week (Sunday-based). */
  private parseOrderDateFromQuery(): Date | null {
    const raw = this.route.snapshot.queryParamMap.get('date');
    if (!raw) {
      return null;
    }
    return this.hebrew.parseIso(raw.trim());
  }

  private syncDateSelectors(date: Date): void {
    this.selectedGregorianMonth.set(date.getMonth());
    this.selectedGregorianYear.set(date.getFullYear());
    const hd = new HDate(date);
    this.selectedHebrewMonth.set(hd.getMonth());
    this.selectedHebrewYear.set(hd.getFullYear());
  }

  private generateHebrewYears(): ReadonlyArray<{ value: number; label: string }> {
    const currentYear = new HDate(new Date()).getFullYear();
    const options: Array<{ value: number; label: string }> = [];
    for (let year = currentYear - 5; year <= currentYear + 5; year++) {
      const hebrewYearLabel = new HDate(1, months.TISHREI, year).renderGematriya().split(' ').pop() ?? `${year}`;
      options.push({ value: year, label: hebrewYearLabel });
    }
    return options;
  }

  private isHebrewLeapYear(year: number): boolean {
    return [0, 3, 6, 8, 11, 14, 17].includes(year % 19);
  }

  private buildRows(): GridRow[] {
    const start = this.weekStart();
    const ordersByKey = new Map<string, OrderDto[]>();
    for (const order of this.orders()) {
      const key = this.cellKey(order.equipmentType, order.orderDate, order.timeSlot);
      const bucket = ordersByKey.get(key) ?? [];
      bucket.push(order);
      ordersByKey.set(key, bucket);
    }
    for (const [, list] of ordersByKey) {
      list.sort((a, b) => a.id - b.id);
    }

    const rows: GridRow[] = [];
    for (let i = 0; i < 7; i++) {
      const date = this.addDays(start, i);
      const day = date.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
      const isFriday = day === 5;
      const isSaturday = day === 6;
      const iso = this.toIsoDate(date);

      const buildSlot = (slotInner: TimeSlot): GridCell[] => {
        const cols = this.gridColumns();
        const ordersByColumnId = this.assignOrdersToGridColumns(iso, slotInner, ordersByKey, cols);
        return cols.map((col) => {
          const orders = ordersByColumnId.get(col.id) ?? [];
          const isMaintenance = col.isUnderMaintenance;
          return {
            columnId: col.id,
            columnHeaderLabel: col.headerLabel,
            orders,
            disabled: orders.length === 0 && isMaintenance,
            isMaintenance,
            bookingSlot: col.bookingSlot,
            date,
            timeSlot: slotInner
          };
        });
      };

      const morning = isSaturday ? null : buildSlot(TimeSlot.Morning);
      const evening = isFriday ? null : buildSlot(TimeSlot.Evening);

      rows.push({
        date,
        dayLabel: DAY_NAMES_HE[day],
        hebrewDate: this.hebrew.toHebrew(date),
        gregorian: this.formatDate(date),
        isShabbat: isFriday || isSaturday,
        morning,
        evening
      });
    }
    return rows;
  }

  private cellKey(bookingSlot: string, iso: string, slot: TimeSlot): string {
    return `${bookingSlot}|${iso}|${slot}`;
  }

  private assignOrdersToGridColumns(
    iso: string,
    slot: TimeSlot,
    ordersByKey: Map<string, OrderDto[]>,
    cols: WeeklyGridColumnDef[]
  ): Map<string, OrderDto[]> {
    const result = new Map<string, OrderDto[]>();
    for (const col of cols) {
      result.set(col.id, []);
    }

    for (const col of cols) {
      const key = this.cellKey(col.bookingSlot, iso, slot);
      const orders = ordersByKey.get(key) ?? [];
      result.set(col.id, [...orders].sort((a, b) => a.id - b.id));
    }

    return result;
  }

  private startOfWeek(date: Date): Date {
    const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = result.getDay(); // 0 = Sunday
    result.setDate(result.getDate() - day);
    return result;
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  private toIsoDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  protected formatDate(date: Date): string {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}.${m}.${y}`;
  }
}
