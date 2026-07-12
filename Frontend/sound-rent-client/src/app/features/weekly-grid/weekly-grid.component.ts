import { CommonModule } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
  viewChildren
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { HDate, months } from '@hebcal/core';
import { forkJoin, finalize, Subscription, timer, EMPTY, merge } from 'rxjs';
import { debounceTime, map, switchMap } from 'rxjs/operators';

import {
  DEPOSIT_TYPE_LABELS,
  EQUIPMENT_TYPE_LABELS,
  EquipmentType,
  LOANED_EQUIPMENT_LABELS,
  ReturnTimeType,
  TIME_SLOT_LABELS,
  TimeSlot
} from '../../core/models/enums';
import { OrderDto, OrderShiftDto } from '../../core/models/order.model';
import {
  bookingSlotToBaseEquipment,
  defaultBookingSlotForEquipmentType
} from '../../core/models/booking-slots';
import { CustomerDto } from '../../core/models/customer.model';
import { EquipmentDefinitionDto } from '../../core/models/equipment-definition.model';
import { WaitlistEntryDto } from '../../core/models/waitlist.model';
import {
  blockedDateCellLabel,
  BlockedDateDto,
  findBlockedDateForIso
} from '../../core/models/blocked-date.model';
import { CalendarViewStateService } from '../../core/services/calendar-view-state.service';
import { DataService } from '../../core/services/data.service';
import { CustomersStore } from '../../core/services/customers.store';
import { EquipmentDefinitionsStore } from '../../core/services/equipment-definitions.store';
import { EquipmentMaintenanceSyncService } from '../../core/services/equipment-maintenance-sync.service';
import { ExportService } from '../../core/services/export.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';
import { customerColorKey, customerOrderColors } from '../../core/utils/customer-order-colors';
import {
  ISRAELI_PHONE_INVALID_MESSAGE,
  israeliPhoneValidator
} from '../../core/validators/israeli-phone.validator';
import { IntegerOnlyDirective } from '../../shared/directives/integer-only.directive';

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
  isBlocked: boolean;
  blockedReason: string | null;
  bookingSlot: string;
  date: Date;
  timeSlot: TimeSlot;
}

interface GridSlotSegment {
  key: string;
  cell: GridCell;
  colspan: number;
  orders: OrderDto[];
  merged: boolean;
  verticalPosition: 'single' | 'top' | 'middle' | 'bottom';
  renderDetails: boolean;
  renderAddAnother: boolean;
}

interface GridRow {
  date: Date;
  dayLabel: string;
  hebrewDate: string;
  gregorian: string;
  isShabbat: boolean;
  isBlockedDay: boolean;
  blockedDayLabel: string | null;
  morning: GridSlotSegment[] | null;
  evening: GridSlotSegment[] | null;
  waitlist: WaitlistEntryDto[];
  /** Order ids on this day that share a last name with another distinct order. */
  sameDayLastNameDuplicateOrderIds: ReadonlySet<number>;
}

interface WeekDayHeader {
  iso: string;
  dayLabel: string;
  dayShort: string;
  gregorian: string;
  hebrewDate: string;
  isShabbat: boolean;
}

interface WeekBlock {
  startIso: string;
  weekStart: Date;
  weekEnd: Date;
  gregorianRange: string;
  hebrewRange: string;
  rows: GridRow[];
}

const DAY_NAMES_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const DAY_NAMES_SHORT_HE = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
const EMPTY_ORDER_ID_SET: ReadonlySet<number> = new Set();
const SAME_DAY_NAME_DUPLICATE_TOOLTIP = 'שים לב! יש עוד הזמנה על שם זהה היום';
const INITIAL_WEEKS_LOADED = 2;
const MAX_WEEKS_LOADED = 20;
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

interface DashboardDateFilterState {
  weekStart: Date;
  gregorianMonth: number;
  gregorianYear: number;
  hebrewMonth: number;
  hebrewYear: number;
}

interface OrderContextMenuState {
  orderId: number;
  customerName: string | null | undefined;
  phone: string;
  urgentBoardNote: string | null | undefined;
  x: number;
  y: number;
}

interface UrgentNoteDialogState {
  orderId: number;
  customerName: string | null | undefined;
  phone: string;
}

function toLocalIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function createInitialDashboardDateState(): DashboardDateFilterState {
  const hebrewSvc = inject(HebrewDateService);
  const route = inject(ActivatedRoute);
  const calendarView = inject(CalendarViewStateService);
  // Prefer URL (?date=), then remembered board date, then today.
  const raw =
    route.snapshot.queryParamMap.get('date')?.trim() ||
    calendarView.selectedDateIso() ||
    null;
  const anchor = raw ? hebrewSvc.parseIso(raw) ?? new Date() : new Date();
  const weekStart = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const monthAnchor = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const hebrew = hebrewSvc.toHebrewParts(monthAnchor);
  calendarView.setSelectedDate(toLocalIsoDate(anchor));
  return {
    weekStart,
    gregorianMonth: anchor.getMonth(),
    gregorianYear: anchor.getFullYear(),
    hebrewMonth: hebrew.month,
    hebrewYear: hebrew.year
  };
}

@Component({
  selector: 'app-weekly-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, IntegerOnlyDirective],
  templateUrl: './weekly-grid.component.html',
  styleUrl: './weekly-grid.component.scss'
})
export class WeeklyGridComponent {
  private readonly initialDateState = createInitialDashboardDateState();
  private readonly data = inject(DataService);
  private readonly customers = inject(CustomersStore);
  private readonly exportSvc = inject(ExportService);
  private readonly equipmentSlots = inject(EquipmentDefinitionsStore);
  private readonly maintenanceSync = inject(EquipmentMaintenanceSyncService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly calendarView = inject(CalendarViewStateService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  private static readonly POLL_INTERVAL_MS = 30_000;
  private static readonly CUSTOMER_SUGGEST_LIMIT = 8;

  private weekLoadSub: Subscription | null = null;
  private appendLoadSub: Subscription | null = null;
  private weekLoadInFlightKey = '';
  private weekIntersectionObserver: IntersectionObserver | null = null;
  private loadMoreObserver: IntersectionObserver | null = null;
  private headerResizeObserver: ResizeObserver | null = null;
  private syncingUrlFromScroll = false;

  private readonly gridScroll = viewChild<ElementRef<HTMLElement>>('gridScroll');
  private readonly equipmentHeaderRow = viewChild<ElementRef<HTMLTableRowElement>>('equipmentHeaderRow');
  private readonly daysHeaderRow = viewChild<ElementRef<HTMLTableRowElement>>('daysHeaderRow');
  private readonly weekMarkers = viewChildren<ElementRef<HTMLElement>>('weekMarker');
  private readonly loadMoreSentinel = viewChild<ElementRef<HTMLElement>>('loadMoreSentinel');

  protected readonly maxWeeksLoaded = MAX_WEEKS_LOADED;
  protected readonly equipmentLabels = EQUIPMENT_TYPE_LABELS;
  protected readonly timeSlotLabels = TIME_SLOT_LABELS;
  protected readonly israeliPhoneInvalidMessage = ISRAELI_PHONE_INVALID_MESSAGE;

  protected readonly customerSuggestions = signal<CustomerDto[]>([]);
  protected readonly customerSuggestOpen = signal(false);
  protected readonly customerSuggestField = signal<'name' | 'phone' | null>(null);
  protected readonly customerSuggestIndex = signal(-1);

  /** Live speaker slots from the equipment catalog (same source as order forms). */
  protected readonly waitlistSpeakerOptions = computed(() =>
    this.equipmentSlots.definitions().filter((d) => d.category === 'Speakers')
  );

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

  /** First (anchor) week currently loaded in the continuous board. */
  protected readonly weekStart = signal<Date>(this.initialDateState.weekStart);
  /** How many consecutive weeks are loaded from `weekStart`. */
  protected readonly weeksCount = signal(INITIAL_WEEKS_LOADED);
  /** Week currently most visible while scrolling (drives toolbar + URL). */
  protected readonly activeWeekStart = signal<Date>(this.initialDateState.weekStart);
  protected readonly orders = signal<OrderDto[]>([]);
  protected readonly waitlistEntries = signal<WaitlistEntryDto[]>([]);
  protected readonly blockedDates = signal<BlockedDateDto[]>([]);
  protected readonly waitlistSaving = signal(false);
  protected readonly waitlistModalContext = signal<{ date: Date } | null>(null);
  protected readonly exportBackupInProgress = signal(false);
  protected readonly dashboardRefreshing = signal(false);
  protected readonly loadingMoreWeeks = signal(false);
  protected readonly hoveredOrderId = signal<number | null>(null);
  protected readonly orderContextMenu = signal<OrderContextMenuState | null>(null);
  protected readonly urgentNoteDialog = signal<UrgentNoteDialogState | null>(null);
  protected readonly urgentNoteDraft = signal('');
  protected readonly urgentNoteSaving = signal(false);

  protected readonly waitlistModalForm = this.fb.group({
    bookingSlot: this.fb.nonNullable.control('', Validators.required),
    customerName: ['', Validators.maxLength(100)],
    phone: ['', [Validators.required, Validators.maxLength(10), israeliPhoneValidator()]],
    address: ['', Validators.maxLength(500)],
    notes: ['', Validators.maxLength(1000)]
  });
  protected readonly gregorianMonths = GREGORIAN_MONTH_OPTIONS;
  protected readonly selectedGregorianMonth = signal(this.initialDateState.gregorianMonth);
  protected readonly selectedGregorianYear = signal(this.initialDateState.gregorianYear);
  protected readonly selectedHebrewMonth = signal(this.initialDateState.hebrewMonth);
  protected readonly selectedHebrewYear = signal(this.initialDateState.hebrewYear);

  protected readonly hebrewMonthOptions = computed(() =>
    this.isHebrewLeapYear(this.selectedHebrewYear())
      ? LEAP_HEBREW_MONTH_OPTIONS
      : COMMON_HEBREW_MONTH_OPTIONS
  );

  protected readonly hebrewYearOptions = computed(() =>
    this.buildHebrewYearOptions(this.selectedHebrewYear())
  );

  protected readonly weekEnd = computed(() => this.addDays(this.activeWeekStart(), 6));

  protected readonly rangeEnd = computed(() =>
    this.addDays(this.weekStart(), this.weeksCount() * 7 - 1)
  );

  protected readonly gregorianRange = computed(() => {
    const fmt = (d: Date) => this.formatDate(d);
    return `${fmt(this.activeWeekStart())} – ${fmt(this.weekEnd())}`;
  });

  protected readonly hebrewRange = computed(() =>
    this.hebrew.toHebrewRange(this.activeWeekStart(), this.weekEnd())
  );

  /** Sticky Sun–Sat strip under the equipment models header. */
  protected readonly activeWeekDays = computed<WeekDayHeader[]>(() => {
    const start = this.activeWeekStart();
    const days: WeekDayHeader[] = [];
    for (let i = 0; i < 7; i++) {
      const date = this.addDays(start, i);
      const day = date.getDay();
      days.push({
        iso: this.toIsoDate(date),
        dayLabel: DAY_NAMES_HE[day]!,
        dayShort: DAY_NAMES_SHORT_HE[day]!,
        gregorian: this.formatDate(date),
        hebrewDate: this.hebrew.toHebrew(date),
        isShabbat: day === 5 || day === 6
      });
    }
    return days;
  });

  protected readonly weeks = computed<WeekBlock[]>(() => {
    const start = this.weekStart();
    const count = this.weeksCount();
    const blocks: WeekBlock[] = [];
    for (let w = 0; w < count; w++) {
      const weekStart = this.addDays(start, w * 7);
      const weekEnd = this.addDays(weekStart, 6);
      blocks.push({
        startIso: this.toIsoDate(weekStart),
        weekStart,
        weekEnd,
        gregorianRange: `${this.formatDate(weekStart)} – ${this.formatDate(weekEnd)}`,
        hebrewRange: this.hebrew.toHebrewRange(weekStart, weekEnd),
        rows: this.buildRowsForWeek(weekStart)
      });
    }
    return blocks;
  });

  constructor() {
    // Keep ?date= in the URL so refresh / shared links restore the same week.
    this.persistViewedDate(this.activeWeekStart(), { replaceUrl: true });

    effect(() => {
      const v = this.maintenanceSync.version();
      if (v === 0) {
        return;
      }
      untracked(() => {
        this.equipmentSlots.load({ force: true }).subscribe();
      });
    });

    effect(() => {
      const start = this.weekStart();
      untracked(() => {
        this.weeksCount.set(INITIAL_WEEKS_LOADED);
        this.activeWeekStart.set(start);
        const end = this.addDays(start, INITIAL_WEEKS_LOADED * 7 - 1);
        this.loadWeekData(this.toIsoDate(start), this.toIsoDate(end), { replace: true });
        queueMicrotask(() => this.scrollBoardToTop());
      });
    });

    timer(WeeklyGridComponent.POLL_INTERVAL_MS, WeeklyGridComponent.POLL_INTERVAL_MS)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const start = this.toIsoDate(this.weekStart());
        const end = this.toIsoDate(this.rangeEnd());
        this.loadWeekData(start, end, { replace: true });
      });

    this.wireWaitlistCustomerAutocomplete();

    afterNextRender(() => {
      this.setupScrollObservers();
      this.setupStickyHeaderOffsets();
    });

    effect(() => {
      // Re-bind week markers whenever the continuous week list changes.
      this.weeks();
      untracked(() => queueMicrotask(() => this.setupWeekIntersectionObserver()));
    });

    this.destroyRef.onDestroy(() => {
      this.weekIntersectionObserver?.disconnect();
      this.loadMoreObserver?.disconnect();
      this.headerResizeObserver?.disconnect();
    });
  }

  protected refreshDashboard(): void {
    const start = this.toIsoDate(this.weekStart());
    const end = this.toIsoDate(this.rangeEnd());
    this.loadWeekData(start, end, { replace: true });
  }

  protected onGregorianMonthModelChange(value: number): void {
    this.selectedGregorianMonth.set(value);
    this.applyGregorianSelection();
  }

  protected onHebrewMonthModelChange(value: number): void {
    this.selectedHebrewMonth.set(value);
    this.applyHebrewSelection();
  }

  protected onHebrewYearModelChange(value: number): void {
    this.selectedHebrewYear.set(value);
    const monthOptions = this.hebrewMonthOptions();
    const monthStillValid = monthOptions.some((m) => m.value === this.selectedHebrewMonth());
    if (!monthStillValid) {
      this.selectedHebrewMonth.set(monthOptions[monthOptions.length - 1].value);
    }
    this.applyHebrewSelection();
  }

  protected previousWeek(): void {
    this.navigateToDate(this.addDays(this.activeWeekStart(), -7));
  }

  protected nextWeek(): void {
    this.navigateToDate(this.addDays(this.activeWeekStart(), 7));
  }

  protected goToday(): void {
    this.navigateToDate(new Date());
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
            const byDate = this.primaryOrderDate(a).localeCompare(this.primaryOrderDate(b));
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
          void this.exportSvc
            .exportMultiSheetExcel(
              [
                { sheetName: 'הזמנות', rows: orderRows },
                { sheetName: 'רשימת המתנה', rows: waitlistRows }
              ],
              `גיבוי_מלא_${stamp}`
            )
            .then(() => this.toast.success('קובץ Excel הורד (הזמנות + רשימת המתנה)'));
        }
      });
  }

  private orderToBackupExcelRow(o: OrderDto): Record<string, unknown> {
    return {
      מזהה: o.id,
      'מפתח ציוד': o.equipmentDefinitionIds.join(', '),
      'תיאור ציוד': o.equipmentDefinitionIds.map((id) => this.equipmentSlots.displayLabel(id)).join(', '),
      תאריך: o.shifts.map((s) => s.orderDate).join(', '),
      משמרת: o.shifts.map((s) => this.timeSlotLabels[s.timeSlot]).join(', '),
      'שעת החזרה': this.returnTimeLabel(o),
      'שם לקוח': o.customerName ?? '',
      טלפון: o.phone,
      'טלפון 2': o.phone2 ?? '',
      כתובת: o.address ?? '',
      פיקדון: o.depositType != null ? DEPOSIT_TYPE_LABELS[o.depositType] : '',
      'שם על הפיקדון': o.depositOnName ?? '',
      'סכום תשלום': o.paymentAmount ?? '',
      שולם: o.isUnpaid ? 'לא' : 'כן',
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
      const label = le.isCustomItem
        ? (le.customItemName?.trim() || 'פריט נוסף')
        : LOANED_EQUIPMENT_LABELS[le.loanedEquipmentType!] ?? String(le.loanedEquipmentType);
      const noteTexts = (le.notes ?? [])
        .filter((n) => (n.content ?? '').trim().length > 0)
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((n) => `#${n.ordinal + 1}: ${(n.content ?? '').trim()}`);
      const noteSuffix = noteTexts.length > 0 ? ` (${noteTexts.join('; ')})` : '';
      parts.push(`${label} ×${le.quantity}${noteSuffix}`);
    }
    return parts.join(' | ');
  }

  protected onGregorianYearChange(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    if (Number.isNaN(value)) {
      return;
    }
    this.selectedGregorianYear.set(value);
    this.applyGregorianSelection();
  }

  protected showGregorianDate(): void {
    this.applyGregorianSelection();
  }

  protected showHebrewDate(): void {
    this.applyHebrewSelection();
  }

  protected onEmptyCellClick(cell: GridCell): void {
    if (cell.orders.length > 0) {
      return;
    }

    if (cell.isMaintenance) {
      this.toast.error('הציוד בתיקון - לא ניתן להוסיף הזמנה חדשה');
      return;
    }

    if (cell.isBlocked) {
      this.toast.error(cell.blockedReason ? `התאריך חסום: ${cell.blockedReason}` : 'התאריך חסום להזמנות חדשות');
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
    this.closeOrderContextMenu();
    this.router.navigate(['/orders', orderId]);
  }

  protected onOrderContextMenu(event: MouseEvent, order: OrderDto): void {
    event.preventDefault();
    event.stopPropagation();
    const pad = 8;
    const menuW = 220;
    const menuH = 44;
    const x = Math.min(event.clientX, window.innerWidth - menuW - pad);
    const y = Math.min(event.clientY, window.innerHeight - menuH - pad);
    this.orderContextMenu.set({
      orderId: order.id,
      customerName: order.customerName,
      phone: order.phone,
      urgentBoardNote: order.urgentBoardNote,
      x: Math.max(pad, x),
      y: Math.max(pad, y)
    });
  }

  protected closeOrderContextMenu(): void {
    this.orderContextMenu.set(null);
  }

  protected openUrgentBoardNoteDialog(): void {
    const menu = this.orderContextMenu();
    if (!menu) {
      return;
    }
    this.urgentNoteDraft.set((menu.urgentBoardNote ?? '').trim());
    this.urgentNoteDialog.set({
      orderId: menu.orderId,
      customerName: menu.customerName,
      phone: menu.phone
    });
    this.closeOrderContextMenu();
  }

  protected closeUrgentBoardNoteDialog(): void {
    if (this.urgentNoteSaving()) {
      return;
    }
    this.urgentNoteDialog.set(null);
    this.urgentNoteDraft.set('');
  }

  protected saveUrgentBoardNote(): void {
    const dialog = this.urgentNoteDialog();
    if (!dialog || this.urgentNoteSaving()) {
      return;
    }
    const note = this.urgentNoteDraft().trim();
    this.urgentNoteSaving.set(true);
    this.data
      .updateUrgentBoardNote(dialog.orderId, note.length > 0 ? note : null)
      .pipe(finalize(() => this.urgentNoteSaving.set(false)))
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.orders.update((list) =>
          list.map((o) => (o.id === updated.id ? { ...o, urgentBoardNote: updated.urgentBoardNote } : o))
        );
        this.urgentNoteDialog.set(null);
        this.urgentNoteDraft.set('');
        this.toast.success('ההערה הדחופה נשמרה');
      });
  }

  protected addAnotherOrder(cell: GridCell): void {
    if (!cell.bookingSlot) {
      return;
    }
    if (cell.isMaintenance) {
      this.toast.error('הציוד בתיקון - לא ניתן להוסיף הזמנה חדשה');
      return;
    }
    if (cell.isBlocked) {
      this.toast.error(cell.blockedReason ? `התאריך חסום: ${cell.blockedReason}` : 'התאריך חסום להזמנות חדשות');
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

  protected segmentBookingLabel(segment: GridSlotSegment): string {
    if (segment.colspan <= 1) {
      return this.cellBookingLabel(segment.cell);
    }
    return `${this.cellBookingLabel(segment.cell)} ועוד ${segment.colspan - 1}`;
  }

  protected setHoveredOrder(orderId: number | null): void {
    this.hoveredOrderId.set(orderId);
  }

  protected isOrderHovered(orderId: number): boolean {
    return this.hoveredOrderId() === orderId;
  }

  protected orderBlockStyle(order: OrderDto): Record<string, string> {
    const color = customerOrderColors(customerColorKey(order));
    return {
      '--order-bg': color.bg,
      '--order-border': color.border
    };
  }

  protected hasOrderNotes(order: OrderDto): boolean {
    return (order.notes ?? '').trim().length > 0;
  }

  protected hasUrgentBoardNote(order: OrderDto): boolean {
    return (order.urgentBoardNote ?? '').trim().length > 0;
  }

  protected urgentBoardNoteText(order: OrderDto): string {
    return (order.urgentBoardNote ?? '').trim();
  }

  protected hasNameDuplicateOnSameDay(order: OrderDto, row: GridRow): boolean {
    return row.sameDayLastNameDuplicateOrderIds.has(order.id);
  }

  protected readonly sameDayNameDuplicateTooltip = SAME_DAY_NAME_DUPLICATE_TOOLTIP;

  protected orderNotesTooltip(order: OrderDto): string {
    return (order.notes ?? '').trim();
  }

  protected returnTimeLabel(order: OrderDto): string {
    return this.finalReturnTimeLabel(order);
  }

  protected returnTimeLabelForCell(order: OrderDto, cellDate: Date): string {
    const lastShift = this.orderLastShift(order);
    if (!lastShift) {
      return this.finalReturnTimeLabel(order);
    }

    const cellIso = this.toIsoDate(cellDate);
    const isOnEndDate = cellIso === lastShift.orderDate;

    if (!isOnEndDate) {
      const returnDay = this.hebrew.parseIso(lastShift.orderDate);
      if (returnDay) {
        const dayName = DAY_NAMES_HE[returnDay.getDay()];
        if (dayName) {
          return `מחזיר ב${dayName}`;
        }
      }
    }

    return this.finalReturnTimeLabel(order);
  }

  private finalReturnTimeLabel(order: OrderDto): string {
    switch (order.returnTimeType) {
      case ReturnTimeType.NextMorning:
        return 'עד 08:00';
      case ReturnTimeType.SpecificTime:
        return `עד ${order.customReturnTime ?? ''}`.trim();
      case ReturnTimeType.LateNight:
      default:
        return 'עד הלילה';
    }
  }

  private orderLastShift(order: OrderDto): OrderShiftDto | null {
    const shifts = [...(order.shifts ?? [])].sort(
      (a, b) =>
        a.orderDate.localeCompare(b.orderDate) || this.shiftOrder(a.timeSlot) - this.shiftOrder(b.timeSlot)
    );
    return shifts.length > 0 ? shifts[shifts.length - 1]! : null;
  }

  protected isVerticalContinuation(segment: GridSlotSegment): boolean {
    return segment.verticalPosition === 'middle' || segment.verticalPosition === 'bottom';
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

  protected waitlistBadgeTitle(entry: WaitlistEntryDto): string {
    const parts = [this.waitlistEquipmentLabel(entry)];
    if (entry.notes?.trim()) {
      parts.push(entry.notes.trim());
    }
    return parts.join(' — ');
  }

  protected waitlistEquipmentLabel(entry: WaitlistEntryDto): string {
    return this.equipmentLabels[entry.equipmentType] ?? String(entry.equipmentType);
  }

  protected openAddWaitlistModal(date: Date): void {
    this.waitlistModalContext.set({ date });
    this.closeWaitlistCustomerSuggestions();
    const applyDefaults = (): void => {
      const defaultSlot = this.equipmentSlots.firstAvailableSpeakerSlotId();
      this.waitlistModalForm.reset({
        bookingSlot: defaultSlot,
        customerName: '',
        phone: '',
        address: '',
        notes: ''
      });
    };
    if (this.waitlistSpeakerOptions().length === 0) {
      this.equipmentSlots.load({ force: true }).subscribe({
        next: () => applyDefaults(),
        error: () => applyDefaults()
      });
      return;
    }
    applyDefaults();
  }

  protected closeWaitlistModal(): void {
    this.closeWaitlistCustomerSuggestions();
    this.waitlistModalContext.set(null);
  }

  protected waitlistCustomerSuggestLabel(c: CustomerDto): string {
    const name = (c.fullName ?? '').trim() || 'ללא שם';
    return `${name} - ${c.phone1}`;
  }

  protected onWaitlistCustomerSuggestFocus(field: 'name' | 'phone'): void {
    this.customerSuggestField.set(field);
    if (this.customerSuggestions().length > 0) {
      this.customerSuggestOpen.set(true);
    }
  }

  protected onWaitlistCustomerSuggestBlur(): void {
    setTimeout(() => this.closeWaitlistCustomerSuggestions(), 150);
  }

  protected onWaitlistCustomerSuggestKeydown(event: KeyboardEvent, field: 'name' | 'phone'): void {
    if (!this.customerSuggestOpen() || this.customerSuggestField() !== field) {
      if (event.key === 'ArrowDown' && this.customerSuggestions().length > 0) {
        this.customerSuggestField.set(field);
        this.customerSuggestOpen.set(true);
        this.customerSuggestIndex.set(0);
        event.preventDefault();
      }
      return;
    }

    const list = this.customerSuggestions();
    if (list.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.customerSuggestIndex.update((i) => (i + 1) % list.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.customerSuggestIndex.update((i) => (i <= 0 ? list.length - 1 : i - 1));
      return;
    }
    if (event.key === 'Enter') {
      const idx = this.customerSuggestIndex();
      const pick = idx >= 0 ? list[idx] : null;
      if (pick) {
        event.preventDefault();
        this.selectWaitlistCustomerSuggestion(pick);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeWaitlistCustomerSuggestions();
    }
  }

  protected selectWaitlistCustomerSuggestion(c: CustomerDto, event?: Event): void {
    event?.preventDefault();
    this.waitlistModalForm.patchValue(
      {
        customerName: c.fullName ?? '',
        phone: c.phone1 ?? '',
        address: c.address ?? ''
      },
      { emitEvent: false }
    );
    this.closeWaitlistCustomerSuggestions();
    this.toast.show('פרטי הלקוח מולאו מהרשימה', 'info');
  }

  private closeWaitlistCustomerSuggestions(): void {
    this.customerSuggestOpen.set(false);
    this.customerSuggestIndex.set(-1);
    this.customerSuggestions.set([]);
    this.customerSuggestField.set(null);
  }

  private wireWaitlistCustomerAutocomplete(): void {
    const name$ = this.waitlistModalForm.controls.customerName.valueChanges.pipe(
      map((v) => ({ field: 'name' as const, q: String(v ?? '').trim() }))
    );
    const phone$ = this.waitlistModalForm.controls.phone.valueChanges.pipe(
      map((v) => ({ field: 'phone' as const, q: String(v ?? '').trim() }))
    );

    merge(name$, phone$)
      .pipe(
        debounceTime(300),
        switchMap(({ field, q }) => {
          if (q.length < 1 || !this.waitlistModalContext()) {
            this.closeWaitlistCustomerSuggestions();
            return EMPTY;
          }
          return this.customers.search(q).pipe(
            map((list) => ({
              field,
              q,
              list: list.slice(0, WeeklyGridComponent.CUSTOMER_SUGGEST_LIMIT)
            }))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ field, q, list }) => {
        if (!this.waitlistModalContext()) {
          return;
        }
        const current =
          field === 'name'
            ? String(this.waitlistModalForm.controls.customerName.value ?? '').trim()
            : String(this.waitlistModalForm.controls.phone.value ?? '').trim();
        if (current !== q) {
          return;
        }
        if (list.length === 0) {
          this.closeWaitlistCustomerSuggestions();
          return;
        }
        this.customerSuggestField.set(field);
        this.customerSuggestions.set(list);
        this.customerSuggestIndex.set(0);
        this.customerSuggestOpen.set(true);
      });
  }

  protected submitWaitlistModal(): void {
    const ctx = this.waitlistModalContext();
    if (!ctx) {
      return;
    }
    if (this.waitlistModalForm.invalid) {
      this.waitlistModalForm.markAllAsTouched();
      this.toast.error('אנא מלאו את השדות הנדרשים');
      return;
    }

    const v = this.waitlistModalForm.getRawValue();
    const equipmentType = bookingSlotToBaseEquipment(v.bookingSlot);
    if (equipmentType === null) {
      this.toast.error('סוג הציוד שנבחר אינו תקין');
      return;
    }

    const phone = WeeklyGridComponent.digitsOnly((v.phone ?? '').trim());
    const customerName = ((v.customerName as string) || '').trim() || null;
    const address = ((v.address as string) || '').trim() || null;

    this.waitlistSaving.set(true);
    this.data
      .createWaitlistEntry({
        customerName,
        phone,
        equipmentType,
        date: this.toIsoDate(ctx.date),
        notes: ((v.notes as string) || '').trim() || null,
        address
      })
      .pipe(finalize(() => this.waitlistSaving.set(false)))
      .subscribe({
        next: (created) => {
          if (created === null) {
            return;
          }
          this.customers.upsertFromPayload({
            phone1: phone,
            fullName: customerName,
            address
          });
          this.toast.success('נוסף לרשימת ההמתנה');
          this.closeWaitlistModal();
          this.reloadCurrentWeek();
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
        this.reloadCurrentWeek();
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
        customerName: entry.customerName?.trim() ? entry.customerName : undefined,
        notes: entry.notes?.trim() ? entry.notes : undefined
      }
    });
  }

  protected blockedCellLabel(cell: GridCell): string {
    return blockedDateCellLabel({
      id: 0,
      startDate: '',
      endDate: '',
      reason: cell.blockedReason,
      createdAt: '',
      updatedAt: ''
    });
  }

  protected isColumnMaintenance(col: WeeklyGridColumnDef): boolean {
    return col.isUnderMaintenance;
  }

  private blockForIso(iso: string): BlockedDateDto | null {
    return findBlockedDateForIso(iso, this.blockedDates());
  }

  private reloadCurrentWeek(): void {
    this.loadWeekData(this.toIsoDate(this.weekStart()), this.toIsoDate(this.rangeEnd()), {
      replace: true
    });
  }

  private loadWeekData(
    start: string,
    end: string,
    options: { replace: boolean }
  ): void {
    const key = `${start}|${end}|${options.replace ? 'r' : 'm'}`;

    this.weekLoadSub?.unsubscribe();
    this.weekLoadInFlightKey = key;
    this.equipmentSlots.load({ force: true }).subscribe();

    this.dashboardRefreshing.set(true);
    this.weekLoadSub = forkJoin({
      orders: this.data.getWeeklyOrders(start, end),
      waitlist: this.data.getWeeklyWaitlist(start, end),
      blockedDates: this.data.getBlockedDates(start, end)
    })
      .pipe(
        finalize(() => this.dashboardRefreshing.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: ({ orders, waitlist, blockedDates }) => {
          if (this.weekLoadInFlightKey !== key) {
            return;
          }
          this.weekLoadInFlightKey = '';
          if (options.replace) {
            this.orders.set(orders);
            this.waitlistEntries.set(waitlist);
            this.blockedDates.set(blockedDates);
          } else {
            this.orders.update((prev) => this.mergeById(prev, orders));
            this.waitlistEntries.update((prev) => this.mergeById(prev, waitlist));
            this.blockedDates.update((prev) => this.mergeBlockedDates(prev, blockedDates));
          }
        },
        error: () => {
          if (this.weekLoadInFlightKey === key) {
            this.weekLoadInFlightKey = '';
          }
        }
      });
  }

  private appendNextWeeks(): void {
    if (this.loadingMoreWeeks() || this.weeksCount() >= MAX_WEEKS_LOADED) {
      return;
    }

    const nextWeekStart = this.addDays(this.weekStart(), this.weeksCount() * 7);
    const nextWeekEnd = this.addDays(nextWeekStart, 6);
    const start = this.toIsoDate(nextWeekStart);
    const end = this.toIsoDate(nextWeekEnd);

    this.loadingMoreWeeks.set(true);
    this.appendLoadSub?.unsubscribe();
    this.appendLoadSub = forkJoin({
      orders: this.data.getWeeklyOrders(start, end),
      waitlist: this.data.getWeeklyWaitlist(start, end),
      blockedDates: this.data.getBlockedDates(start, end)
    })
      .pipe(
        finalize(() => this.loadingMoreWeeks.set(false)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe({
        next: ({ orders, waitlist, blockedDates }) => {
          this.orders.update((prev) => this.mergeById(prev, orders));
          this.waitlistEntries.update((prev) => this.mergeById(prev, waitlist));
          this.blockedDates.update((prev) => this.mergeBlockedDates(prev, blockedDates));
          this.weeksCount.update((count) => Math.min(MAX_WEEKS_LOADED, count + 1));
        }
      });
  }

  private mergeById<T extends { id: number }>(prev: T[], incoming: T[]): T[] {
    if (incoming.length === 0) {
      return prev;
    }
    const map = new Map<number, T>();
    for (const item of prev) {
      map.set(item.id, item);
    }
    for (const item of incoming) {
      map.set(item.id, item);
    }
    return [...map.values()];
  }

  private mergeBlockedDates(prev: BlockedDateDto[], incoming: BlockedDateDto[]): BlockedDateDto[] {
    if (incoming.length === 0) {
      return prev;
    }
    const map = new Map<number, BlockedDateDto>();
    for (const item of prev) {
      map.set(item.id, item);
    }
    for (const item of incoming) {
      map.set(item.id, item);
    }
    return [...map.values()];
  }

  private navigateToDate(date: Date): void {
    const weekStart = this.startOfWeek(date);
    this.weekStart.set(weekStart);
    this.activeWeekStart.set(weekStart);
    this.syncFiltersFromDate(date);
    this.persistViewedDate(date);
  }

  /** Persist viewed date in shared state and `?date=` so leaving the board does not reset to today. */
  private persistViewedDate(date: Date, options?: { replaceUrl?: boolean }): void {
    const iso = this.toIsoDate(date);
    this.calendarView.setSelectedDate(iso);
    const current = this.route.snapshot.queryParamMap.get('date');
    if (current === iso) {
      return;
    }
    this.syncingUrlFromScroll = true;
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: { date: iso },
        queryParamsHandling: 'merge',
        replaceUrl: options?.replaceUrl ?? true
      })
      .finally(() => {
        this.syncingUrlFromScroll = false;
      });
  }

  private setActiveWeekFromScroll(weekStartIso: string): void {
    if (this.syncingUrlFromScroll) {
      return;
    }
    const parsed = this.hebrew.parseIso(weekStartIso);
    if (!parsed) {
      return;
    }
    const weekStart = this.startOfWeek(parsed);
    const currentIso = this.toIsoDate(this.activeWeekStart());
    const nextIso = this.toIsoDate(weekStart);
    if (currentIso === nextIso) {
      return;
    }
    this.activeWeekStart.set(weekStart);
    this.syncFiltersFromDate(weekStart);
    this.persistViewedDate(weekStart, { replaceUrl: true });
  }

  private setupScrollObservers(): void {
    this.setupWeekIntersectionObserver();
    this.setupLoadMoreObserver();
  }

  private setupWeekIntersectionObserver(): void {
    const root = this.gridScroll()?.nativeElement;
    if (!root) {
      return;
    }

    this.weekIntersectionObserver?.disconnect();
    const markers = this.weekMarkers();
    if (markers.length === 0) {
      return;
    }

    // Prefer the week whose marker sits just under the sticky headers.
    this.weekIntersectionObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const top = visible[0];
        const weekStart = top?.target.getAttribute('data-week-start');
        if (weekStart) {
          this.setActiveWeekFromScroll(weekStart);
        }
      },
      {
        root,
        // Offset for sticky equipment + day headers so the "active" week is the one under them.
        rootMargin: '-120px 0px -55% 0px',
        threshold: [0, 0.1, 0.25, 0.5, 1]
      }
    );

    for (const marker of markers) {
      this.weekIntersectionObserver.observe(marker.nativeElement);
    }
  }

  private setupLoadMoreObserver(): void {
    const root = this.gridScroll()?.nativeElement;
    const sentinel = this.loadMoreSentinel()?.nativeElement;
    if (!root || !sentinel) {
      return;
    }

    this.loadMoreObserver?.disconnect();
    this.loadMoreObserver = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          this.appendNextWeeks();
        }
      },
      {
        root,
        rootMargin: '240px 0px',
        threshold: 0
      }
    );
    this.loadMoreObserver.observe(sentinel);
  }

  private setupStickyHeaderOffsets(): void {
    const scrollEl = this.gridScroll()?.nativeElement;
    const equipRow = this.equipmentHeaderRow()?.nativeElement;
    const daysRow = this.daysHeaderRow()?.nativeElement;
    if (!scrollEl || !equipRow || !daysRow) {
      return;
    }

    const apply = (): void => {
      const equipH = Math.ceil(equipRow.getBoundingClientRect().height);
      scrollEl.style.setProperty('--wg-equip-header-h', `${equipH}px`);
      const daysH = Math.ceil(daysRow.getBoundingClientRect().height);
      scrollEl.style.setProperty('--wg-days-header-h', `${daysH}px`);
    };

    apply();
    this.headerResizeObserver?.disconnect();
    this.headerResizeObserver = new ResizeObserver(() => apply());
    this.headerResizeObserver.observe(equipRow);
    this.headerResizeObserver.observe(daysRow);
  }

  private scrollBoardToTop(): void {
    const el = this.gridScroll()?.nativeElement;
    if (el) {
      el.scrollTop = 0;
    }
  }

  private syncFiltersFromDate(date: Date): void {
    this.syncFiltersFromGregorianMonthYear(date.getFullYear(), date.getMonth());
  }

  private syncFiltersFromGregorianMonthYear(gregorianYear: number, gregorianMonth: number): void {
    const anchor = new Date(gregorianYear, gregorianMonth, 1);
    this.selectedGregorianMonth.set(anchor.getMonth());
    this.selectedGregorianYear.set(anchor.getFullYear());
    const hebrew = this.hebrew.toHebrewParts(anchor);
    this.selectedHebrewMonth.set(hebrew.month);
    this.selectedHebrewYear.set(hebrew.year);
  }

  private syncFiltersFromHebrewMonthYear(hebrewYear: number, hebrewMonth: number): void {
    const anchor = this.hebrew.toGregorian(hebrewYear, hebrewMonth, 1);
    this.selectedHebrewMonth.set(hebrewMonth);
    this.selectedHebrewYear.set(hebrewYear);
    this.selectedGregorianMonth.set(anchor.getMonth());
    this.selectedGregorianYear.set(anchor.getFullYear());
  }

  private applyGregorianSelection(): void {
    const gregorianYear = this.selectedGregorianYear();
    const gregorianMonth = this.selectedGregorianMonth();
    const target = new Date(gregorianYear, gregorianMonth, 1);
    if (Number.isNaN(target.getTime())) {
      this.toast.error('שנה לועזית לא תקינה');
      return;
    }
    this.syncFiltersFromGregorianMonthYear(gregorianYear, gregorianMonth);
    const weekStart = this.startOfWeek(target);
    this.weekStart.set(weekStart);
    this.activeWeekStart.set(weekStart);
    this.persistViewedDate(target);
  }

  private applyHebrewSelection(): void {
    const hebrewYear = this.selectedHebrewYear();
    const hebrewMonth = this.selectedHebrewMonth();
    try {
      const target = this.hebrew.toGregorian(hebrewYear, hebrewMonth, 1);
      this.syncFiltersFromHebrewMonthYear(hebrewYear, hebrewMonth);
      const weekStart = this.startOfWeek(target);
      this.weekStart.set(weekStart);
      this.activeWeekStart.set(weekStart);
      this.persistViewedDate(target);
    } catch {
      this.toast.error('תאריך עברי לא תקין');
    }
  }

  private buildHebrewYearOptions(selectedYear: number): ReadonlyArray<{ value: number; label: string }> {
    const currentYear = new HDate(new Date()).getFullYear();
    let minYear = currentYear - 5;
    let maxYear = currentYear + 5;
    if (selectedYear < minYear) {
      minYear = selectedYear;
    }
    if (selectedYear > maxYear) {
      maxYear = selectedYear;
    }

    const options: Array<{ value: number; label: string }> = [];
    for (let year = minYear; year <= maxYear; year++) {
      options.push({
        value: year,
        label: this.hebrewYearLabel(year)
      });
    }
    return options;
  }

  private hebrewYearLabel(year: number): string {
    return new HDate(1, months.TISHREI, year).renderGematriya().split(' ').pop() ?? `${year}`;
  }

  private isHebrewLeapYear(year: number): boolean {
    return [0, 3, 6, 8, 11, 14, 17].includes(year % 19);
  }

  private buildRowsForWeek(start: Date): GridRow[] {
    const ordersByKey = new Map<string, OrderDto[]>();
    const weekStartIso = this.toIsoDate(start);
    const weekEndIso = this.toIsoDate(this.addDays(start, 6));

    for (const order of this.orders()) {
      for (const equipmentId of order.equipmentDefinitionIds) {
        for (const shift of order.shifts) {
          if (shift.orderDate < weekStartIso || shift.orderDate > weekEndIso) {
            continue;
          }
          const key = this.cellKey(equipmentId, shift.orderDate, shift.timeSlot);
          const bucket = ordersByKey.get(key) ?? [];
          bucket.push(order);
          ordersByKey.set(key, bucket);
        }
      }
    }
    for (const [, list] of ordersByKey) {
      list.sort((a, b) => a.id - b.id);
    }

    const waitlistByIso = new Map<string, WaitlistEntryDto[]>();
    for (const entry of this.waitlistEntries()) {
      if (entry.date < weekStartIso || entry.date > weekEndIso) {
        continue;
      }
      const bucket = waitlistByIso.get(entry.date) ?? [];
      bucket.push(entry);
      waitlistByIso.set(entry.date, bucket);
    }
    for (const [, list] of waitlistByIso) {
      list.sort((a, b) => {
        const eq = a.equipmentType.localeCompare(b.equipmentType);
        return eq !== 0 ? eq : a.id - b.id;
      });
    }

    const sameDayLastNameDuplicates = this.buildSameDayLastNameDuplicateOrderIds(
      this.orders().filter((o) =>
        (o.shifts ?? []).some((s) => s.orderDate >= weekStartIso && s.orderDate <= weekEndIso)
      )
    );

    const rows: GridRow[] = [];
    for (let i = 0; i < 7; i++) {
      const date = this.addDays(start, i);
      const day = date.getDay(); // 0 = Sunday, 5 = Friday, 6 = Saturday
      const isFriday = day === 5;
      const isSaturday = day === 6;
      const iso = this.toIsoDate(date);
      const dayBlock = this.blockForIso(iso);
      const blockedDayLabel = dayBlock ? blockedDateCellLabel(dayBlock) : null;

      const buildSlot = (slotInner: TimeSlot): GridSlotSegment[] => {
        const cols = this.gridColumns();
        const ordersByColumnId = this.assignOrdersToGridColumns(iso, slotInner, ordersByKey, cols);
        const cells = cols.map((col) => {
          const orders = ordersByColumnId.get(col.id) ?? [];
          const isMaintenance = col.isUnderMaintenance;
          const isBlocked = dayBlock !== null;
          const blockedReason = dayBlock?.reason?.trim() || null;
          return {
            columnId: col.id,
            columnHeaderLabel: col.headerLabel,
            orders,
            disabled: orders.length === 0 && (isMaintenance || isBlocked),
            isMaintenance,
            isBlocked,
            blockedReason,
            bookingSlot: col.bookingSlot,
            date,
            timeSlot: slotInner
          };
        });
        return this.buildSlotSegments(cells);
      };

      const morning = isSaturday ? null : buildSlot(TimeSlot.Morning);
      const evening = isFriday ? null : buildSlot(TimeSlot.Evening);

      rows.push({
        date,
        dayLabel: DAY_NAMES_HE[day],
        hebrewDate: this.hebrew.toHebrew(date),
        gregorian: this.formatDate(date),
        isShabbat: isFriday || isSaturday,
        isBlockedDay: dayBlock !== null,
        blockedDayLabel,
        morning,
        evening,
        waitlist: waitlistByIso.get(iso) ?? [],
        sameDayLastNameDuplicateOrderIds: sameDayLastNameDuplicates.get(iso) ?? EMPTY_ORDER_ID_SET
      });
    }
    return rows;
  }

  /**
   * One pass over all orders: for each calendar day, flag distinct orders that share
   * the same extracted last name (final whitespace-delimited token).
   */
  private buildSameDayLastNameDuplicateOrderIds(orders: OrderDto[]): Map<string, Set<number>> {
    const lastNameBucketsByDay = new Map<string, Map<string, Set<number>>>();

    for (const order of orders) {
      const lastNameKey = this.customerLastNameKey(order.customerName);
      if (!lastNameKey) {
        continue;
      }

      const daysOnOrder = new Set((order.shifts ?? []).map((shift) => shift.orderDate));
      for (const iso of daysOnOrder) {
        let dayBuckets = lastNameBucketsByDay.get(iso);
        if (!dayBuckets) {
          dayBuckets = new Map();
          lastNameBucketsByDay.set(iso, dayBuckets);
        }
        let orderIds = dayBuckets.get(lastNameKey);
        if (!orderIds) {
          orderIds = new Set();
          dayBuckets.set(lastNameKey, orderIds);
        }
        orderIds.add(order.id);
      }
    }

    const flaggedByDay = new Map<string, Set<number>>();
    for (const [iso, dayBuckets] of lastNameBucketsByDay) {
      const flagged = new Set<number>();
      for (const orderIds of dayBuckets.values()) {
        if (orderIds.size < 2) {
          continue;
        }
        for (const id of orderIds) {
          flagged.add(id);
        }
      }
      if (flagged.size > 0) {
        flaggedByDay.set(iso, flagged);
      }
    }

    return flaggedByDay;
  }

  private customerLastNameKey(fullName: string | null | undefined): string {
    const normalized = (fullName ?? '').trim().replace(/\s+/g, ' ');
    if (!normalized) {
      return '';
    }
    const parts = normalized.split(' ');
    const lastName = parts[parts.length - 1] ?? '';
    return lastName.toLocaleLowerCase('he-IL');
  }

  private cellKey(bookingSlot: string, iso: string, slot: TimeSlot): string {
    return `${bookingSlot}|${iso}|${slot}`;
  }

  private buildSlotSegments(cells: GridCell[]): GridSlotSegment[] {
    const segments: GridSlotSegment[] = [];
    let i = 0;

    while (i < cells.length) {
      const cell = cells[i]!;
      const singleOrder = cell.orders.length === 1 ? cell.orders[0]! : null;
      let colspan = 1;

      if (singleOrder) {
        while (
          i + colspan < cells.length &&
          cells[i + colspan]!.orders.length === 1 &&
          cells[i + colspan]!.orders[0]!.id === singleOrder.id
        ) {
          colspan++;
        }
      }

      const verticalPosition = singleOrder
        ? this.orderVerticalPosition(singleOrder, this.toIsoDate(cell.date), cell.timeSlot)
        : 'single';

      segments.push({
        key: `${this.cellTrackKey(cell)}-${singleOrder?.id ?? 'empty'}-${colspan}`,
        cell,
        colspan,
        orders: singleOrder ? [singleOrder] : cell.orders,
        merged: colspan > 1,
        verticalPosition,
        renderDetails: verticalPosition === 'single' || verticalPosition === 'top',
        renderAddAnother:
          !cell.isBlocked &&
          (verticalPosition === 'single' || verticalPosition === 'bottom')
      });
      i += colspan;
    }

    return segments;
  }

  private orderVerticalPosition(
    order: OrderDto,
    iso: string,
    slot: TimeSlot
  ): GridSlotSegment['verticalPosition'] {
    const shifts = [...(order.shifts ?? [])]
      .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || this.shiftOrder(a.timeSlot) - this.shiftOrder(b.timeSlot));
    const idx = shifts.findIndex((s) => s.orderDate === iso && s.timeSlot === slot);
    if (idx < 0 || shifts.length <= 1) {
      return 'single';
    }
    if (idx === 0) {
      return 'top';
    }
    if (idx === shifts.length - 1) {
      return 'bottom';
    }
    return 'middle';
  }

  private shiftOrder(slot: TimeSlot): number {
    return slot === TimeSlot.Morning ? 1 : 2;
  }

  private primaryOrderDate(order: OrderDto): string {
    return order.shifts[0]?.orderDate ?? '';
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

  private static digitsOnly(raw: string): string {
    return raw.replace(/\D/g, '');
  }
}
