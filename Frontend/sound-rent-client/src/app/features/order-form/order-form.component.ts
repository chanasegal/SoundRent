import { CommonModule, DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, afterNextRender, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  Subject,
  concatMap,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  finalize,
  from,
  groupBy,
  map,
  merge,
  mergeMap,
  of,
  startWith,
  switchMap,
  tap,
  toArray
} from 'rxjs';

import {
  DEPOSIT_TYPE_LABELS,
  DepositType,
  LOANED_EQUIPMENT_ORDER,
  LoanedEquipmentType,
  RETURN_TIME_TYPE_LABELS,
  ReturnTimeType,
  TIME_SLOT_LABELS,
  TimeSlot,
  workspacePageTitle
} from '../../core/models/enums';
import { normalizeOrderEquipmentQueryParam } from '../../core/models/booking-slots';
import { CustomerDto, CustomerSuggestDto } from '../../core/models/customer.model';
import {
  LOST_EQUIPMENT_ACTIVE_STATUSES,
  LostEquipmentDto
} from '../../core/models/lost-equipment.model';
import { LoanedEquipmentNoteDto, OrderCreateUpdateDto, OrderDto, OrderLoanedEquipmentDto, OrderShiftDto, InstitutionConflictDto } from '../../core/models/order.model';
import { InstitutionDto } from '../../core/models/institution.model';
import { OrderReturnRequestDto, UnreturnedItemDto } from '../../core/models/equipment-return.model';
import { EquipmentDefinitionAvailabilityDto } from '../../core/models/equipment-definition.model';
import { InventoryDefinitionDto } from '../../core/models/inventory-definition.model';
import { AccessorySerialOptionDto } from '../../core/models/accessory-inventory.model';
import { BlockedDateDto, findBlockedDateForIso } from '../../core/models/blocked-date.model';
import { CalendarViewStateService } from '../../core/services/calendar-view-state.service';
import { DataService } from '../../core/services/data.service';
import { EquipmentDefinitionsStore } from '../../core/services/equipment-definitions.store';
import { InventoryDefinitionsStore } from '../../core/services/inventory-definitions.store';
import { CustomersStore } from '../../core/services/customers.store';
import { EquipmentMaintenanceSyncService } from '../../core/services/equipment-maintenance-sync.service';
import { HebrewDateService, HebrewDateParts, HebrewMonthOption } from '../../core/services/hebrew-date.service';
import {
  OrderDraftService,
  SoundOrderDraftPayload
} from '../../core/services/order-draft.service';
import { OrdersSyncService } from '../../core/services/orders-sync.service';
import { SystemContextService } from '../../core/services/system-context.service';
import { ToastService } from '../../core/services/toast.service';
import { IntegerOnlyDirective } from '../../shared/directives/integer-only.directive';
import { IsraeliPhoneInputDirective } from '../../shared/directives/israeli-phone-input.directive';
import { HebrewCalendarPickerComponent } from '../../shared/hebrew-calendar-picker/hebrew-calendar-picker.component';
import {
  israeliPhoneValidator,
  ISRAELI_PHONE_INVALID_MESSAGE,
  isValidIsraeliPhone,
  optionalIsraeliPhoneValidator
} from '../../core/validators/israeli-phone.validator';

interface ReturnModalRow {
  rowId: string;
  loanedEquipmentId: number;
  label: string;
  quantityLoaned: number;
  quantityReturned: number;
  isCustomItem: boolean;
  assignedSerialCodes: string[];
  returnedSerialCodes: string[];
  /** Codes already persisted as returned — stay selected and cannot be unchecked. */
  lockedReturnedSerialCodes: string[];
  /** Quantity already persisted as returned — quantity input cannot go below this. */
  alreadyReturnedQuantity: number;
}

/** Per booking-block occupancy map and UI helpers. */
interface BookingUiState {
  occupiedById: Record<string, boolean>;
  slotTaken: boolean;
  equipmentDropdownOpen: boolean;
  startHebrewYear: number;
  startHebrewMonth: number;
  startHebrewDay: number;
  endHebrewYear: number;
  endHebrewMonth: number;
  endHebrewDay: number;
}

@Component({
  selector: 'app-order-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    IntegerOnlyDirective,
    IsraeliPhoneInputDirective,
    HebrewCalendarPickerComponent
  ],
  templateUrl: './order-form.component.html',
  styleUrl: './order-form.component.scss'
})
export class OrderFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly data = inject(DataService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly hebrew = inject(HebrewDateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly equipmentSlots = inject(EquipmentDefinitionsStore);
  private readonly inventoryStore = inject(InventoryDefinitionsStore);
  private readonly customers = inject(CustomersStore);
  private readonly maintenanceSync = inject(EquipmentMaintenanceSyncService);
  private readonly ordersSync = inject(OrdersSyncService);
  private readonly calendarView = inject(CalendarViewStateService);
  private readonly systemContext = inject(SystemContextService);
  private readonly orderDraft = inject(OrderDraftService);

  /** Preserves the board week when using "חזרה ללוח". */
  protected readonly boardQueryParams = computed(() => {
    const fromService = this.calendarView.dashboardQueryParams();
    if (fromService.date) {
      return fromService;
    }
    const fromQuery = this.route.snapshot.queryParamMap.get('date')?.trim();
    return fromQuery && /^\d{4}-\d{2}-\d{2}$/.test(fromQuery) ? { date: fromQuery } : {};
  });

  protected readonly bookingEquipmentSlotIds = computed(() =>
    this.equipmentSlots
      .boardSlotDefinitions()
      .filter((d) => d.isUnderMaintenance !== true)
      .map((d) => d.id)
  );

  protected readonly timeSlots: TimeSlot[] = [TimeSlot.Morning, TimeSlot.Evening];
  protected readonly timeSlotLabels = TIME_SLOT_LABELS;

  /** Shifts allowed for a Gregorian date (Friday → morning only, Saturday → evening only). */
  protected availableTimeSlots(iso: string | null | undefined): TimeSlot[] {
    const d = typeof iso === 'string' ? this.hebrew.parseIso(iso) : null;
    if (!d) {
      return this.timeSlots;
    }
    const dow = d.getDay();
    if (dow === 5) {
      return [TimeSlot.Morning];
    }
    if (dow === 6) {
      return [TimeSlot.Evening];
    }
    return this.timeSlots;
  }

  /** Used in the template: invalid shift options stay visible but disabled (no helper text). */
  protected isStartShiftSelectable(bookingIndex: number, slot: TimeSlot): boolean {
    return this.availableTimeSlots(this.bookingGroup(bookingIndex).controls['startDate'].value as string).includes(slot);
  }

  protected isEndShiftSelectable(bookingIndex: number, slot: TimeSlot): boolean {
    return this.availableTimeSlots(this.bookingGroup(bookingIndex).controls['endDate'].value as string).includes(slot);
  }

  protected slotDropdownLabel(slot: string): string {
    return this.equipmentSlots.displayLabel(slot);
  }

  protected isEquipmentSelected(bookingIndex: number, slot: string): boolean {
    return this.equipmentIdsControl(bookingIndex).value.includes(slot);
  }

  protected isEquipmentOccupied(bookingIndex: number, slot: string): boolean {
    return this.bookingUi()[bookingIndex]?.occupiedById[slot] === true;
  }

  protected toggleEquipmentDropdown(bookingIndex: number): void {
    this.patchBookingUi(bookingIndex, {
      equipmentDropdownOpen: !this.bookingUi()[bookingIndex]?.equipmentDropdownOpen
    });
  }

  protected isEquipmentDropdownOpen(bookingIndex: number): boolean {
    return this.bookingUi()[bookingIndex]?.equipmentDropdownOpen === true;
  }

  protected selectedEquipmentSummary(bookingIndex: number): string {
    const selected = this.equipmentIdsControl(bookingIndex).value ?? [];
    if (selected.length === 0) {
      return 'בחרו תאי ציוד';
    }
    return selected.map((id) => this.slotDropdownLabel(id)).join(', ');
  }

  protected toggleEquipmentSelection(bookingIndex: number, slot: string, checked: boolean): void {
    const ctrl = this.equipmentIdsControl(bookingIndex);
    const current = ctrl.value ?? [];
    const next = checked
      ? [...current, slot]
      : current.filter((id) => id !== slot);
    ctrl.setValue([...new Set(next)]);
    ctrl.markAsTouched();
    this.refreshSlotTakenWarning(bookingIndex);
  }

  protected selectedShiftRows(bookingIndex: number): OrderShiftDto[] {
    return (this.shiftsArray(bookingIndex).getRawValue() as OrderShiftDto[])
      .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || Number(a.timeSlot) - Number(b.timeSlot));
  }

  protected formatSelectedShiftDate(iso: string): string {
    const d = this.hebrew.parseIso(iso);
    return d ? this.hebrew.formatGregorianWithDayName(d) : iso;
  }

  protected rangeSummary(bookingIndex: number): string {
    const rows = this.selectedShiftRows(bookingIndex);
    return rows.length === 0 ? 'לא נוצרו מועדים' : `${rows.length} משמרות רצופות`;
  }

  protected slotTaken(bookingIndex: number): boolean {
    return this.bookingUi()[bookingIndex]?.slotTaken === true;
  }

  protected startHebrewYear(bookingIndex: number): number {
    return this.bookingUi()[bookingIndex]?.startHebrewYear ?? 0;
  }

  protected startHebrewMonth(bookingIndex: number): number {
    return this.bookingUi()[bookingIndex]?.startHebrewMonth ?? 0;
  }

  protected startHebrewDay(bookingIndex: number): number {
    return this.bookingUi()[bookingIndex]?.startHebrewDay ?? 0;
  }

  protected endHebrewYear(bookingIndex: number): number {
    return this.bookingUi()[bookingIndex]?.endHebrewYear ?? 0;
  }

  protected endHebrewMonth(bookingIndex: number): number {
    return this.bookingUi()[bookingIndex]?.endHebrewMonth ?? 0;
  }

  protected endHebrewDay(bookingIndex: number): number {
    return this.bookingUi()[bookingIndex]?.endHebrewDay ?? 0;
  }

  protected startYearOptionsAt(bookingIndex: number): number[] {
    return this.yearOptionsForEndpoint(bookingIndex, 'start');
  }

  protected endYearOptionsAt(bookingIndex: number): number[] {
    return this.yearOptionsForEndpoint(bookingIndex, 'end');
  }

  protected startMonthOptionsAt(bookingIndex: number): HebrewMonthOption[] {
    return this.monthOptionsForEndpoint(bookingIndex, 'start');
  }

  protected endMonthOptionsAt(bookingIndex: number): HebrewMonthOption[] {
    return this.monthOptionsForEndpoint(bookingIndex, 'end');
  }

  protected startDayOptionsAt(bookingIndex: number): number[] {
    return this.dayOptionsForEndpoint(bookingIndex, 'start');
  }

  protected endDayOptionsAt(bookingIndex: number): number[] {
    return this.dayOptionsForEndpoint(bookingIndex, 'end');
  }

  protected canAddBooking(): boolean {
    return !this.isEdit();
  }

  protected canRemoveBooking(bookingIndex: number): boolean {
    return !this.isEdit() && this.bookings.length > 1 && bookingIndex > 0;
  }

  protected addBooking(): void {
    if (!this.canAddBooking()) {
      return;
    }
    const group = this.buildBookingGroup();
    this.bookings.push(group);
    const index = this.bookings.length - 1;
    this.ensureBookingUi(index);
    this.wireBookingGroup(index);
    this.syncShiftsFromRange(index);
  }

  protected removeBooking(bookingIndex: number): void {
    if (!this.canRemoveBooking(bookingIndex)) {
      return;
    }
    this.bookings.removeAt(bookingIndex);
    this.bookingUi.update((states) => {
      const next = [...states];
      next.splice(bookingIndex, 1);
      return next;
    });
    this.refreshAccessorySerialAvailability();
  }

  protected readonly depositTypes: DepositType[] = [
    DepositType.Check,
    DepositType.CreditCard,
    DepositType.Cash
  ];
  protected readonly depositTypeLabels = DEPOSIT_TYPE_LABELS;
  protected readonly returnTimeTypes: ReturnTimeType[] = [
    ReturnTimeType.SpecificTime,
    ReturnTimeType.LateNight,
    ReturnTimeType.NextMorning
  ];
  protected readonly returnTimeTypeLabels = RETURN_TIME_TYPE_LABELS;
  protected readonly returnTimeTypeEnum = ReturnTimeType;
  protected readonly israeliPhoneInvalidMessage = ISRAELI_PHONE_INVALID_MESSAGE;

  protected readonly editingId = signal<number | null>(null);
  protected readonly orderCancelled = signal(false);
  protected readonly loadedOrder = signal<OrderDto | null>(null);
  private readonly returnedSerialCodesByType = signal<Map<LoanedEquipmentType, Set<string>>>(new Map());
  private readonly loanedLineIdsByType = signal<Map<LoanedEquipmentType, number>>(new Map());
  protected readonly returnModalOpen = signal(false);
  protected readonly returnSaving = signal(false);
  protected readonly returnRows = signal<ReturnModalRow[]>([]);
  protected readonly returnSerialDropdownRowId = signal<string | null>(null);

  /** Active (unresolved) forgotten-equipment rows matching this order's customer. */
  protected readonly activeLostEquipment = signal<LostEquipmentDto[]>([]);

  /** Report unreturned equipment modal (דווח על ציוד שלא חזר). */
  protected readonly unreturnedReportOpen = signal(false);
  protected readonly unreturnedReportSaving = signal(false);
  protected readonly unreturnedItemOptions = computed(() => this.inventoryStore.definitions());
  protected readonly unreturnedReportForm = this.fb.group({
    customerName: ['', [Validators.maxLength(200)]],
    phone: ['', [Validators.maxLength(20), optionalIsraeliPhoneValidator()]],
    address: ['', [Validators.maxLength(200)]],
    isCustomItem: [false],
    inventoryDefinitionId: [null as number | null],
    customItemName: ['', [Validators.maxLength(200)]],
    itemCode: ['', [Validators.maxLength(100)]]
  });

  protected readonly isEdit = computed(() => this.editingId() !== null);
  protected readonly showLostEquipmentAlert = computed(() => this.activeLostEquipment().length > 0);
  protected readonly lostEquipmentAlertSummary = computed(() => {
    const items = this.activeLostEquipment();
    if (items.length === 0) {
      return '';
    }
    const descriptions = items
      .map((r) => r.itemDescription.trim())
      .filter((d) => d.length > 0)
      .slice(0, 3);
    const extra = items.length > descriptions.length ? ` (+${items.length - descriptions.length})` : '';
    const detail = descriptions.length > 0 ? ` — ${descriptions.join(', ')}${extra}` : '';
    return `ים לב: ללקוח זה יש ציוד שנשכח!${detail}`;
  });
  protected readonly canRecordReturn = computed(() => {
    if (!this.isEdit() || this.orderCancelled()) {
      return false;
    }
    return true;
  });
  protected readonly hasRecordedReturns = computed(() => {
    const order = this.loadedOrder();
    if (!order) {
      return false;
    }
    if (order.isReturnProcessed) {
      return true;
    }
    return (order.loanedEquipments ?? []).some(
      (le) =>
        (le.returnedQuantity ?? 0) > 0 ||
        (le.notes ?? []).some((n) => n.isReturned === true)
    );
  });
  protected readonly title = computed(() =>
    workspacePageTitle(
      this.isEdit() ? 'עריכת הזמנה' : 'הזמנה חדשה',
      this.systemContext.currentSystemType()
    )
  );
  protected readonly submitting = signal(false);

  protected readonly addAccessoryOpen = signal(false);
  protected readonly accessoryTypeQuery = signal('');

  protected readonly form = this.buildForm();

  constructor() {
    afterNextRender(() => this.resetScrollForOrderForm());

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
      const ids = new Set(this.bookingEquipmentSlotIds());
      untracked(() => {
        for (let i = 0; i < this.bookings.length; i++) {
          const ctrl = this.equipmentIdsControl(i);
          const current = ctrl.value ?? [];
          const next = current.filter((id) => ids.has(id));
          if (next.length !== current.length) {
            ctrl.setValue(next, { emitEvent: true });
          }
        }
      });
    });
  }

  // -----------------------------------------------------------------
  // Hebrew-date driven inputs (the "master" fields).
  // The numeric Hebrew Year / Month / Day controls live in the form;
  // the Gregorian `orderDate` is derived from them and kept in sync.
  // -----------------------------------------------------------------


  /** UI state parallel to each booking FormGroup (occupancy, dropdown, Hebrew calendar signals). */
  private readonly bookingUi = signal<BookingUiState[]>([]);

  /** Offer one-click fill when a saved customer matches the typed Phone1 (or Phone2). */
  protected readonly existingCustomerMatch = signal<CustomerSuggestDto | null>(null);

  /** Typeahead suggestions under שם / טלפון 1. */
  protected readonly customerSuggestions = signal<CustomerSuggestDto[]>([]);
  protected readonly customerSuggestOpen = signal(false);
  protected readonly customerSuggestField = signal<'name' | 'phone' | null>(null);
  protected readonly customerSuggestIndex = signal(-1);

  /** Soft warning when another order already uses the same institution on a selected day. */
  protected readonly institutionConflict = signal<InstitutionConflictDto | null>(null);
  private readonly institutionConflictTrigger$ = new Subject<void>();
  protected readonly institutionSuggestions = signal<InstitutionDto[]>([]);
  protected readonly institutionSuggestOpen = signal(false);
  protected readonly institutionSuggestIndex = signal(-1);
  private institutionSuggestBlurTimer: ReturnType<typeof setTimeout> | null = null;

  /** Digits-only snapshot of Phone1 for template visibility (updated on every keystroke). */
  private readonly phone1DigitsSig = signal('');

  private static readonly CUSTOMER_SUGGEST_LIMIT = 8;

  /** Customer fill CTA: new orders only, Phone1 non-empty, match found, fields not already filled. */
  protected readonly showCustomerFillButton = computed((): CustomerSuggestDto | null => {
    if (this.isEdit()) {
      return null;
    }
    if (this.phone1DigitsSig().length === 0) {
      return null;
    }
    const hit = this.existingCustomerMatch();
    if (!hit || this.customerFieldsAlreadyMatch(hit)) {
      return null;
    }
    return hit;
  });

  /** Pulse triggered when a booking's shifts change and equipment availability should be re-fetched. */
  private readonly availabilityFetchTrigger$ = new Subject<number>();
  private readonly accessoryAvailabilityByType = signal<Map<LoanedEquipmentType, AccessorySerialOptionDto[]>>(
    new Map()
  );
  protected readonly accessorySerialDropdownRow = signal<number | null>(null);
  protected readonly accessorySerialQuickEntry = signal('');

  /** Active date blocks loaded from the API (new orders only). */
  private readonly blockedDatesSig = signal<BlockedDateDto[]>([]);

  /** Suppresses range valueChanges handlers while batching start/end setup. */
  private suppressRangeSync = false;

  private readonly extraYearsSig = signal<number[]>([]);

  // Convenience accessors for the template.
  protected get bookings(): FormArray {
    return this.form.get('bookings') as FormArray;
  }

  protected get equipmentList(): FormArray {
    return this.form.get('loanedEquipments') as FormArray;
  }

  protected bookingGroup(index: number): FormGroup {
    return this.bookings.at(index) as FormGroup;
  }

  protected equipmentIdsControl(index: number): FormControl<string[]> {
    return this.bookingGroup(index).get('equipmentDefinitionIds') as FormControl<string[]>;
  }

  protected shiftsArray(index: number): FormArray {
    return this.bookingGroup(index).get('shifts') as FormArray;
  }

  protected getRowGroup(index: number): FormGroup {
    return this.equipmentList.at(index) as FormGroup;
  }

  /** Catalog rows not yet added to the form, sorted A–Z via the shared store. */
  protected availableAccessoryTypes(): InventoryDefinitionDto[] {
    const used = new Set(
      this.equipmentList.controls
        .map((c) => Number((c as FormGroup).get('inventoryDefinitionId')?.value))
        .filter((id) => Number.isFinite(id) && id > 0)
    );
    return this.inventoryStore.definitions().filter((d) => !used.has(d.id));
  }

  protected filteredAccessoryTypes(): InventoryDefinitionDto[] {
    const query = this.accessoryTypeQuery().trim().toLowerCase();
    const available = this.availableAccessoryTypes();
    if (!query) {
      return available;
    }
    return available.filter((d) => d.displayName.toLowerCase().includes(query));
  }

  protected accessoryTypeLabel(def: InventoryDefinitionDto): string {
    return def.displayName;
  }

  protected toggleAddAccessory(): void {
    const willOpen = !this.addAccessoryOpen();
    this.addAccessoryOpen.set(willOpen);
    this.accessoryTypeQuery.set('');
    if (willOpen) {
      queueMicrotask(() => {
        const input = this.document.querySelector<HTMLInputElement>('.add-accessory__search');
        input?.focus();
      });
    }
  }

  protected onAccessoryTypeChosen(def: InventoryDefinitionDto): void {
    if (this.equipmentList.controls.some(
      (c) => Number((c as FormGroup).get('inventoryDefinitionId')?.value) === def.id
    )) {
      this.toast.warning('סוג אביזר זה כבר נוסף');
      return;
    }

    const linked = def.linkedEquipmentType as LoanedEquipmentType | null | undefined;
    const type =
      linked && LOANED_EQUIPMENT_ORDER.includes(linked) ? linked : null;

    this.equipmentList.push(
      this.buildDynamicEquipmentRow({
        inventoryDefinitionId: def.id,
        loanedEquipmentType: type,
        label: def.displayName,
        quantity: 1,
        selectedCodes: [],
        lineId: null,
        isCustomItem: type == null
      })
    );
    this.addAccessoryOpen.set(false);
    this.accessoryTypeQuery.set('');
    this.refreshAccessorySerialAvailability();
  }

  /**
   * When a specific Mixer unit code is selected, attach only that unit's
   * configured default accessory codes.
   */
  private applyMixerDefaultAccessories(mixerSerialCode: string): void {
    const parentSerial = mixerSerialCode.trim();
    if (!parentSerial) {
      return;
    }

    this.data
      .getEquipmentDefaultAccessories(LoanedEquipmentType.Mixer, parentSerial)
      .subscribe((defaults) => {
        if (!defaults?.length) {
          return;
        }

        // Group by catalog definition when present; fall back to system type.
        const byDefinition = new Map<number, { defId: number; type: LoanedEquipmentType | null; codes: string[] }>();
        const byType = new Map<LoanedEquipmentType, string[]>();

        for (const row of defaults) {
          const code = (row.accessorySerialCode ?? '').trim();
          if (!code) {
            continue;
          }
          if (row.inventoryDefinitionId != null && row.inventoryDefinitionId > 0) {
            const key = row.inventoryDefinitionId;
            const existing = byDefinition.get(key) ?? {
              defId: key,
              type: (row.accessoryEquipmentType as LoanedEquipmentType | null) ?? null,
              codes: []
            };
            if (!existing.codes.some((c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0)) {
              existing.codes.push(code);
            }
            byDefinition.set(key, existing);
            continue;
          }
          const type = row.accessoryEquipmentType as LoanedEquipmentType | null;
          if (!type || !LOANED_EQUIPMENT_ORDER.includes(type)) {
            continue;
          }
          const list = byType.get(type) ?? [];
          if (!list.some((c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0)) {
            list.push(code);
          }
          byType.set(type, list);
        }

        let addedAny = false;
        for (const group of byDefinition.values()) {
          if (this.mergeDefaultAccessoryCodesForDefinition(group.defId, group.type, group.codes)) {
            addedAny = true;
          }
        }
        for (const [type, codes] of byType) {
          if (this.mergeDefaultAccessoryCodes(type, codes)) {
            addedAny = true;
          }
        }

        if (addedAny) {
          this.refreshAccessorySerialAvailability();
          this.toast.success(`נוסף ציוד נלווה קבוע למיקסר #${parentSerial}`);
        }
      });
  }

  private mergeDefaultAccessoryCodesForDefinition(
    inventoryDefinitionId: number,
    type: LoanedEquipmentType | null,
    codes: string[]
  ): boolean {
    if (codes.length === 0) {
      return false;
    }

    let rowIndex = this.equipmentList.controls.findIndex(
      (c) => Number((c as FormGroup).get('inventoryDefinitionId')?.value) === inventoryDefinitionId
    );

    if (rowIndex < 0) {
      const def = this.inventoryStore.byId(inventoryDefinitionId);
      if (!def) {
        return type ? this.mergeDefaultAccessoryCodes(type, codes) : false;
      }
      this.equipmentList.push(
        this.buildDynamicEquipmentRow({
          inventoryDefinitionId: def.id,
          loanedEquipmentType: type,
          label: def.displayName,
          quantity: codes.length,
          selectedCodes: [...codes],
          lineId: null,
          isCustomItem: type == null
        })
      );
      return true;
    }

    if (this.isAccessoryRowReadOnly(rowIndex)) {
      return false;
    }

    const ctrl = this.selectedCodesControl(rowIndex);
    const current = [...(ctrl.value ?? [])];
    let changed = false;
    for (const code of codes) {
      if (!current.some((c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0)) {
        current.push(code);
        changed = true;
      }
    }
    if (!changed) {
      return false;
    }

    ctrl.setValue(current);
    ctrl.markAsDirty();
    this.getRowGroup(rowIndex).patchValue(
      { quantity: Math.max(current.length, 1) },
      { emitEvent: false }
    );
    return true;
  }

  /** Ensures a loaned-equipment row exists for `type` and merges serial codes into it. */
  private mergeDefaultAccessoryCodes(type: LoanedEquipmentType, codes: string[]): boolean {
    if (codes.length === 0) {
      return false;
    }

    let rowIndex = this.equipmentList.controls.findIndex(
      (c) => (c as FormGroup).get('loanedEquipmentType')?.value === type
    );

    if (rowIndex < 0) {
      const def =
        this.inventoryStore.definitions().find((d) => d.linkedEquipmentType === type) ?? null;
      if (!def) {
        return false;
      }
      this.equipmentList.push(
        this.buildDynamicEquipmentRow({
          inventoryDefinitionId: def.id,
          loanedEquipmentType: type,
          label: def.displayName,
          quantity: codes.length,
          selectedCodes: [...codes],
          lineId: null,
          isCustomItem: false
        })
      );
      return true;
    }

    if (this.isAccessoryRowReadOnly(rowIndex)) {
      return false;
    }

    const ctrl = this.selectedCodesControl(rowIndex);
    const current = [...(ctrl.value ?? [])];
    let changed = false;
    for (const code of codes) {
      if (!current.some((c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0)) {
        current.push(code);
        changed = true;
      }
    }
    if (!changed) {
      return false;
    }

    ctrl.setValue(current);
    ctrl.markAsDirty();
    this.getRowGroup(rowIndex).patchValue(
      { quantity: Math.max(current.length, 1) },
      { emitEvent: false }
    );
    return true;
  }

  protected removeAccessoryRow(index: number): void {
    if (index < 0 || index >= this.equipmentList.length) {
      return;
    }
    if (this.isAccessoryRowReadOnly(index)) {
      this.toast.warning('לא ניתן להסיר שורה שנעולה לאחר רישום החזרה');
      return;
    }
    this.equipmentList.removeAt(index);
    if (this.accessorySerialDropdownRow() === index) {
      this.accessorySerialDropdownRow.set(null);
      this.accessorySerialQuickEntry.set('');
    } else if ((this.accessorySerialDropdownRow() ?? -1) > index) {
      this.accessorySerialDropdownRow.update((cur) => (cur == null ? null : cur - 1));
    }
  }

  protected updateAccessoryQuantity(rowIndex: number, raw: string): void {
    if (this.isAccessoryRowReadOnly(rowIndex)) {
      return;
    }
    const parsed = Number.parseInt(raw, 10);
    const quantity = Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
    this.getRowGroup(rowIndex).patchValue({ quantity }, { emitEvent: false });
  }

  protected serialOptionsForRow(rowIndex: number): AccessorySerialOptionDto[] {
    const group = this.getRowGroup(rowIndex);
    const type = group.get('loanedEquipmentType')?.value as LoanedEquipmentType | null;
    if (type) {
      return this.accessoryAvailabilityByType().get(type) ?? [];
    }
    const inventoryDefinitionId = Number(group.get('inventoryDefinitionId')?.value);
    const def = Number.isFinite(inventoryDefinitionId)
      ? this.inventoryStore.byId(inventoryDefinitionId)
      : undefined;
    if (!def) {
      return [];
    }

    const selected = (group.get('selectedCodes')?.value as string[] | null) ?? [];
    const initial = (group.get('initialCodes')?.value as string[] | null) ?? [];
    const reserved = new Set(
      [...initial, ...selected]
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
        .map((c) => c.toLowerCase())
    );

    const units = def.serialUnits ?? [];
    if (units.length > 0) {
      return units.map((unit) => {
        const serialCode = unit.serialCode.trim();
        const status = unit.physicalStatus;
        const occupied = status === 'LoanedOut' || status === 'Missing';
        return {
          serialCode,
          isAvailable: !occupied || reserved.has(serialCode.toLowerCase())
        };
      });
    }

    return (def.serialCodes ?? []).map((serialCode) => ({
      serialCode,
      isAvailable: true
    }));
  }

  protected toggleAccessorySerialDropdown(rowIndex: number): void {
    if (this.isAccessoryRowReadOnly(rowIndex)) {
      return;
    }
    this.accessorySerialDropdownRow.update((cur) => {
      const next = cur === rowIndex ? null : rowIndex;
      this.accessorySerialQuickEntry.set('');
      return next;
    });
    if (this.accessorySerialDropdownRow() === rowIndex) {
      queueMicrotask(() => {
        const input = this.document.querySelector<HTMLInputElement>(
          `.loaned-serial-select .multi-select__quick-input`
        );
        input?.focus();
        input?.select();
      });
    }
  }

  protected isAccessorySerialDropdownOpen(rowIndex: number): boolean {
    return this.accessorySerialDropdownRow() === rowIndex;
  }

  protected onAccessorySerialQuickEnter(rowIndex: number, event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const typed = this.accessorySerialQuickEntry().trim();
    if (!typed) {
      return;
    }

    const match = this.serialOptionsForRow(rowIndex).find(
      (opt) => opt.serialCode.localeCompare(typed, undefined, { sensitivity: 'accent' }) === 0
    );

    if (!match) {
      this.toast.warning(`קוד "${typed}" לא קיים במלאי לפריט זה`);
      return;
    }

    if (this.isAccessorySerialLocked(rowIndex, match.serialCode)) {
      this.toast.warning('פריט שהוחזר למלאי לא ניתן לביטול או שינוי');
      return;
    }

    const alreadySelected = this.isAccessorySerialSelected(rowIndex, match.serialCode);
    if (!alreadySelected && !match.isAvailable) {
      this.toast.warning(`קוד "${match.serialCode}" אינו זמין `);
      return;
    }

    this.toggleAccessorySerialSelection(rowIndex, match.serialCode, !alreadySelected);
    this.accessorySerialQuickEntry.set('');
  }

  protected selectedCodesControl(rowIndex: number): FormControl<string[]> {
    return this.getRowGroup(rowIndex).get('selectedCodes') as FormControl<string[]>;
  }

  protected isAccessorySerialSelected(rowIndex: number, code: string): boolean {
    const selected = this.selectedCodesControl(rowIndex).value ?? [];
    return selected.some((c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0);
  }

  protected isAccessorySerialLocked(rowIndex: number, code: string): boolean {
    const type = this.getRowGroup(rowIndex).get('loanedEquipmentType')?.value as
      | LoanedEquipmentType
      | null;
    if (!type) {
      return false;
    }
    return this.isReturnedSerialCode(type, code);
  }

  /** True when a return was recorded and this serial was not marked returned. */
  protected isAccessorySerialNotReturned(rowIndex: number, code: string): boolean {
    if (!this.hasRecordedReturns()) {
      return false;
    }
    if (!this.isAccessorySerialSelected(rowIndex, code)) {
      return false;
    }
    return !this.isAccessorySerialLocked(rowIndex, code);
  }

  /** Missing quantity for a loaned row after a return was saved. */
  protected accessoryMissingQuantity(rowIndex: number): number {
    if (!this.hasRecordedReturns()) {
      return 0;
    }
    const order = this.loadedOrder();
    const group = this.getRowGroup(rowIndex);
    const lineId = Number(group.get('lineId')?.value ?? 0);
    const type = group.get('loanedEquipmentType')?.value as LoanedEquipmentType | null;
    const isCustom = group.get('isCustomItem')?.value === true;
    const label = String(group.get('label')?.value ?? '').trim();

    const line = (order?.loanedEquipments ?? []).find((le) => {
      if (lineId > 0 && le.id === lineId) {
        return true;
      }
      if (isCustom) {
        return le.isCustomItem && (le.customItemName ?? '').trim() === label;
      }
      return !le.isCustomItem && le.loanedEquipmentType === type;
    });

    if (!line) {
      return 0;
    }
    return Math.max(0, line.quantity - (line.returnedQuantity ?? 0));
  }

  protected isReturnedSerialCode(type: LoanedEquipmentType, code: string): boolean {
    const returned = this.returnedSerialCodesByType().get(type);
    if (returned) {
      const inSignal = [...returned].some(
        (c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
      );
      if (inSignal) {
        return true;
      }
    }

    const line = this.loadedOrder()?.loanedEquipments?.find(
      (le) => !le.isCustomItem && le.loanedEquipmentType === type
    );
    return (line?.notes ?? []).some(
      (n) =>
        n.isReturned &&
        (n.content ?? '').trim().localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
    );
  }

  protected isAccessoryRowReadOnly(rowIndex: number): boolean {
    if (!this.hasRecordedReturns()) {
      return false;
    }
    const selected = this.selectedCodesControl(rowIndex).value ?? [];
    if (selected.length === 0) {
      return false;
    }
    return selected.every((code) => this.isAccessorySerialLocked(rowIndex, code));
  }

  protected toggleAccessorySerialSelection(rowIndex: number, code: string, checked: boolean): void {
    if (!checked && this.isAccessorySerialLocked(rowIndex, code)) {
      this.toast.warning('פריט שהוחזר למלאי לא ניתן לביטול או שינוי');
      return;
    }

    const ctrl = this.selectedCodesControl(rowIndex);
    const current = ctrl.value ?? [];
    const next = checked
      ? [...current, code]
      : current.filter((c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) !== 0);
    const unique: string[] = [];
    for (const item of next) {
      if (!unique.some((u) => u.localeCompare(item, undefined, { sensitivity: 'accent' }) === 0)) {
        unique.push(item);
      }
    }
    ctrl.setValue(unique);
    ctrl.markAsDirty();
    const quantity = unique.length > 0 ? unique.length : Number(this.getRowGroup(rowIndex).get('quantity')?.value) || 1;
    this.getRowGroup(rowIndex).patchValue({ quantity }, { emitEvent: false });

    if (checked) {
      const type = this.getRowGroup(rowIndex).get('loanedEquipmentType')?.value as
        | LoanedEquipmentType
        | null;
      if (type === LoanedEquipmentType.Mixer) {
        this.applyMixerDefaultAccessories(code);
      }
    }
  }

  protected selectedAccessorySerialSummary(rowIndex: number): string {
    const codes = this.selectedCodesControl(rowIndex).value ?? [];
    if (codes.length === 0) {
      return 'בחרו פריטים';
    }
    return codes.join(', ');
  }

  protected selectedAccessoryQuantity(rowIndex: number): number {
    const qty = Number(this.getRowGroup(rowIndex).get('quantity')?.value);
    if (Number.isFinite(qty) && qty > 0) {
      return qty;
    }
    return (this.selectedCodesControl(rowIndex).value ?? []).length;
  }

  protected closeAccessorySerialDropdown(): void {
    this.accessorySerialDropdownRow.set(null);
    this.accessorySerialQuickEntry.set('');
  }

  /** Gematriya label for a Hebrew day (e.g. 23 → "כ״ג"). */
  protected dayLabel(day: number): string {
    return this.hebrew.dayGematriya(day);
  }

  /** Gematriya label for a Hebrew year (e.g. 5786 → "תשפ״ו"). */
  protected yearLabel(year: number): string {
    return this.hebrew.yearGematriya(year);
  }

  protected patchHebrewFromCalendar(
    bookingIndex: number,
    endpoint: 'start' | 'end',
    part: Partial<Pick<HebrewDateParts, 'year' | 'month' | 'day'>>
  ): void {
    const patch: Record<string, number> = {};
    if (part.year !== undefined) {
      patch[`${endpoint}HebrewYear`] = part.year;
      this.ensureYearInOptions(part.year);
    }
    if (part.month !== undefined) {
      patch[`${endpoint}HebrewMonth`] = part.month;
    }
    if (part.day !== undefined) {
      patch[`${endpoint}HebrewDay`] = part.day;
    }
    if (Object.keys(patch).length > 0) {
      this.bookingGroup(bookingIndex).patchValue(patch);
    }
  }

  /** Window scroll (layout has no inner scroll container). Clears stray focus from inputs to avoid scroll-into-view jumps. */
  private resetScrollForOrderForm(): void {
    const d = this.document;
    const win = d.defaultView;
    if (!win) {
      return;
    }
    win.scrollTo(0, 0);
    d.documentElement.scrollTop = 0;
    (d.body as HTMLElement).scrollTop = 0;
    const el = d.activeElement;
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLButtonElement
    ) {
      el.blur();
    }
  }

  ngOnInit(): void {
    queueMicrotask(() => this.resetScrollForOrderForm());

    this.equipmentSlots.load({ force: true }).subscribe();
    this.inventoryStore.load().subscribe();

    this.wireEquipmentAvailability();
    this.wireAccessorySerialAvailability();
    this.wireCustomerAutocomplete();
    this.wireLostEquipmentAlertLookup();
    this.wireInstitutionConflictCheck();
    this.wireInstitutionAutocomplete();

    this.data.getBlockedDates().subscribe((blocks) => {
      this.blockedDatesSig.set(blocks);
      if (!this.isEdit()) {
        const start = this.bookingGroup(0).controls['startDate'].value as string;
        const block = start ? findBlockedDateForIso(start, blocks) : null;
        if (block) {
          this.toast.error(
            block.reason?.trim()
              ? `התאריך שנבחר חסום: ${block.reason.trim()}`
              : 'התאריך שנבחר חסום להזמנות חדשות'
          );
        }
      }
      for (let i = 0; i < this.bookings.length; i++) {
        this.bookingGroup(i).updateValueAndValidity({ emitEvent: false });
      }
    });

    const restored = this.orderDraft.takePendingRestore<SoundOrderDraftPayload>('sound-order');
    if (restored) {
      this.applySoundOrderDraft(restored);
      return;
    }

    this.ensureBookingUi(0);
    this.wireBookingGroup(0);

    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam && /^\d+$/.test(idParam)) {
      const id = Number(idParam);
      this.editingId.set(id);
      this.loadOrder(id);
      return;
    }

    const renewFrom = this.route.snapshot.queryParamMap.get('renewFrom');
    if (renewFrom && /^\d+$/.test(renewFrom)) {
      this.loadOrderForRenewal(Number(renewFrom));
      return;
    }

    this.applyCreateModeFromQueryParams();
  }

  /** Backup form state and return to the board without discarding the draft. */
  protected minimizeDraft(): void {
    const customerName = String(this.form.controls['customerName'].value ?? '').trim();
    const editingId = this.editingId();
    const boardDate =
      this.boardQueryParams().date ??
      this.calendarView.selectedDateIso() ??
      null;
    const returnUrl = this.safeReturnUrlFromRoute();

    this.orderDraft.minimize({
      kind: 'sound-order',
      customerLabel: customerName,
      resumePath: editingId !== null ? `/orders/${editingId}` : '/orders/new',
      payload: {
        formValue: this.form.getRawValue() as Record<string, unknown>,
        bookingUi: this.bookingUi().map((ui) => ({ ...ui, occupiedById: { ...ui.occupiedById } })),
        editingId,
        orderCancelled: this.orderCancelled(),
        phone1Digits: this.phone1DigitsSig(),
        returnUrl,
        boardDate
      }
    });

    if (boardDate) {
      this.calendarView.setSelectedDate(boardDate);
    }
    void this.router.navigate(['/dashboard'], {
      queryParams: boardDate ? { date: boardDate } : this.calendarView.dashboardQueryParams()
    });
  }

  /**
   * Pre-fill from `/orders/new?...` when catalog is available (loaded via APP_INITIALIZER).
   */
  private applyCreateModeFromQueryParams(): void {
    const qp = this.route.snapshot.queryParamMap;
    if (
      !qp.has('equipment') &&
      !qp.has('date') &&
      !qp.has('slot') &&
      !qp.has('customerName') &&
      !qp.has('phone') &&
      !qp.has('notes')
    ) {
      return;
    }

    const eq = normalizeOrderEquipmentQueryParam(qp.get('equipment'), (id: string) => this.equipmentSlots.hasSpeakerSlot(id));
    const date = qp.get('date');
    const slotRaw = qp.get('slot');
    const customerName = qp.get('customerName');
    const phone = qp.get('phone');
    const notes = qp.get('notes');

    const rootPatch: Record<string, unknown> = {};
    if (customerName) {
      rootPatch['customerName'] = customerName;
    }
    if (phone) {
      rootPatch['phone'] = phone;
    }
    if (notes) {
      rootPatch['notes'] = notes;
    }
    if (Object.keys(rootPatch).length > 0) {
      this.form.patchValue(rootPatch as never, { emitEvent: false });
      if (phone) {
        this.phone1DigitsSig.set(OrderFormComponent.digitsOnly(phone));
      }
      this.refreshLostEquipmentAlert();
    }

    const booking = this.bookingGroup(0);
    if (eq) {
      booking.patchValue({ equipmentDefinitionIds: [eq] }, { emitEvent: false });
    }

    const slot =
      slotRaw !== null && slotRaw !== '' ? this.parseTimeSlotQueryParam(slotRaw) : null;

    if (date) {
      this.initializeBookingRange(0, date, slot ?? undefined);
      return;
    }

    if (slot !== null) {
      this.runWithoutRangeSync(() => {
        booking.patchValue({ startShift: slot, endShift: slot }, { emitEvent: false });
      });
      this.syncShiftsFromRange(0);
    }
  }

  /**
   * Sets start/end date and shift together so validators never see a partial range
   * (e.g. evening start with morning end on the same day).
   */
  private initializeBookingRange(bookingIndex: number, iso: string, slot?: TimeSlot): void {
    const parts = this.hebrew.isoToHebrewParts(iso);
    if (!parts) {
      return;
    }

    const booking = this.bookingGroup(bookingIndex);
    const resolvedSlot = slot ?? (booking.controls['startShift'].value as TimeSlot);
    this.ensureYearInOptions(parts.year);

    this.runWithoutRangeSync(() => {
      booking.patchValue(
        {
          startHebrewYear: parts.year,
          startHebrewMonth: parts.month,
          startHebrewDay: parts.day,
          endHebrewYear: parts.year,
          endHebrewMonth: parts.month,
          endHebrewDay: parts.day,
          startDate: iso,
          endDate: iso,
          startShift: resolvedSlot,
          endShift: resolvedSlot,
          orderDate: iso
        },
        { emitEvent: false }
      );

      this.syncEndpointHebrewSignals(bookingIndex, 'start');
      this.syncEndpointHebrewSignals(bookingIndex, 'end');

      this.constrainShiftForDate(bookingIndex, iso, 'startShift', false);
      this.constrainShiftForDate(bookingIndex, iso, 'endShift', false);
      this.coerceEndShiftToValidRange(bookingIndex, false);
    });

    this.syncShiftsFromRange(bookingIndex);

    if (this.isIsoBlocked(iso)) {
      this.toast.error('התאריך שנבחר חסום להזמנות חדשות');
    }
  }

  private isIsoBlocked(iso: string): boolean {
    if (this.isEdit()) {
      return false;
    }
    return findBlockedDateForIso(iso, this.blockedDatesSig()) !== null;
  }

  private runWithoutRangeSync(fn: () => void): void {
    this.suppressRangeSync = true;
    try {
      fn();
    } finally {
      this.suppressRangeSync = false;
    }
  }

  private parseTimeSlotQueryParam(raw: string): TimeSlot | null {
    const value = raw.trim();
    if (value === TimeSlot.Morning || value === '1') {
      return TimeSlot.Morning;
    }
    if (value === TimeSlot.Evening || value === '2') {
      return TimeSlot.Evening;
    }
    return null;
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error(this.firstInvalidMessage());
      return;
    }

    this.sendSaveWithConflictOverride();
  }

  protected applyExistingCustomerFill(): void {
    const c = this.existingCustomerMatch();
    if (!c) {
      return;
    }
    this.applyCustomerDetails(c, 'פרטי הלקוח עודכנו מהכרטיס לקוח');
  }

  protected customerSuggestLabel(c: CustomerSuggestDto): string {
    const name = (c.fullName ?? '').trim() || 'ללא שם';
    return `${name} - ${c.phone1}`;
  }

  protected onCustomerSuggestFocus(field: 'name' | 'phone'): void {
    this.customerSuggestField.set(field);
    if (this.customerSuggestions().length > 0) {
      this.customerSuggestOpen.set(true);
    }
  }

  protected onCustomerSuggestBlur(): void {
    // Delay so mousedown on a suggestion can run before the menu closes.
    setTimeout(() => this.closeCustomerSuggestions(), 150);
  }

  protected onCustomerSuggestKeydown(event: KeyboardEvent, field: 'name' | 'phone'): void {
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
        this.selectCustomerSuggestion(pick);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeCustomerSuggestions();
    }
  }

  protected selectCustomerSuggestion(c: CustomerSuggestDto, event?: Event): void {
    event?.preventDefault();
    this.applyCustomerDetails(c, 'פרטי הלקוח מולאו מהרשימה');
  }

  private applyCustomerDetails(c: CustomerSuggestDto, toastMessage: string): void {
    this.form.patchValue(
      {
        customerName: c.fullName ?? '',
        phone: c.phone1 ?? '',
        phone2: c.phone2 ?? '',
        address: c.address ?? ''
      },
      { emitEvent: false }
    );
    this.phone1DigitsSig.set(OrderFormComponent.digitsOnly(c.phone1 ?? ''));
    this.existingCustomerMatch.set(null);
    this.closeCustomerSuggestions();

    this.loadCustomerDirectoryNotes(c.phone1);
    this.toast.show(toastMessage, 'info');
    this.refreshLostEquipmentAlert();
  }

  /** Fetch full profile once for Notes toast after filling from lean suggest. */
  private loadCustomerDirectoryNotes(phone1: string): void {
    const digits = OrderFormComponent.digitsOnly(phone1);
    if (!digits) {
      return;
    }
    this.customers.searchGlobal(digits).subscribe((list) => {
      const full = list.find((row) => row.phone1 === digits || row.phone2 === digits);
      const directoryNotes = full?.notes ?? '';
      if (directoryNotes.trim().length > 0) {
        this.showCustomerDirectoryNotesAlert(directoryNotes);
      }
    });
  }

  private closeCustomerSuggestions(): void {
    this.customerSuggestOpen.set(false);
    this.customerSuggestIndex.set(-1);
    this.customerSuggestions.set([]);
    this.customerSuggestField.set(null);
  }

  /** Toast from customer card notes after "fill details"; stronger styling for payment-risk phrases. */
  private showCustomerDirectoryNotesAlert(notes: string): void {
    const trimmed = notes.trim();
    if (!trimmed) {
      return;
    }
    const display = trimmed.length > 600 ? `${trimmed.slice(0, 600)}…` : trimmed;
    const critical = trimmed.includes('חוב') || trimmed.includes('לא משלם');
    const message = `הערות בכרטיס הלקוח:\n${display}`;
    if (critical) {
      this.toast.show(message, 'error', 25_000);
    } else {
      this.toast.warning(message, 16_000);
    }
  }

  /**
   * Picks the most relevant validation message for the toast banner so the
   * user immediately understands what blocked the save.
   */
  private firstInvalidMessage(): string {
    for (let i = 0; i < this.bookings.length; i++) {
      const booking = this.bookingGroup(i);
      const prefix = this.bookings.length > 1 ? `הזמנה ${i + 1}: ` : '';
      if (booking.errors?.['orderDateInPast']) {
        return `${prefix}לא ניתן לשמור הזמנה לתאריך שעבר`;
      }
      if (booking.errors?.['shiftsRequired']) {
        return `${prefix}יש להוסיף לפחות תאריך ומשמרת אחת להזמנה`;
      }
      if (booking.errors?.['rangeInvalid']) {
        return `${prefix}מועד הסיום חייב להיות אחרי מועד ההתחלה`;
      }
      if (booking.errors?.['selectedShiftInPast']) {
        return `${prefix}לא ניתן לשמור הזמנה עם משמרת מתאריך שעבר`;
      }
      if (booking.errors?.['shiftNotAllowedForDate']) {
        return `${prefix}המשמרת אינה מתאימה ליום הנבחר (שישי — בוקר, שבת — ערב)`;
      }
      if (booking.errors?.['shiftBlocked']) {
        const reason = booking.errors['blockedReason'];
        return typeof reason === 'string' && reason.trim()
          ? `${prefix}התאריך חסום להזמנות חדשות: ${reason.trim()}`
          : `${prefix}התאריך חסום להזמנות חדשות`;
      }
      if (this.equipmentIdsControl(i).errors?.['required']) {
        return `${prefix}יש לבחור לפחות תא ציוד אחד`;
      }
      if (booking.errors?.['returnTimeRequired']) {
        return `${prefix}יש להזין שעת החזרה`;
      }
    }
    const phoneCtrl = this.form.controls['phone'];
    const phone2Ctrl = this.form.controls['phone2'];
    if (phoneCtrl.errors?.['israeliPhone'] || phone2Ctrl.errors?.['israeliPhone']) {
      return ISRAELI_PHONE_INVALID_MESSAGE;
    }
    return 'אנא מלאו את כל השדות הנדרשים';
  }

  /** After save/delete (or failed load): optional in-app return from `returnUrl` query param. */
  private navigateAfterOrderFlow(orderDateIso?: string | null): void {
    const url = this.safeReturnUrlFromRoute();
    const dashQuery = this.dashboardDateQueryParams(orderDateIso);
    if (url !== null) {
      if (url === '/dashboard') {
        void this.router.navigate(['/dashboard'], { queryParams: dashQuery });
        return;
      }
      void this.router.navigateByUrl(url);
      return;
    }
    void this.router.navigate(['/dashboard'], { queryParams: dashQuery });
  }

  /** `date` is only added when it is a valid `yyyy-MM-dd` (Gregorian order date). */
  private dashboardDateQueryParams(orderDateIso: string | null | undefined): { date?: string } {
    if (orderDateIso && typeof orderDateIso === 'string') {
      const t = orderDateIso.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
        this.calendarView.setSelectedDate(t);
        return { date: t };
      }
    }
    return this.calendarView.dashboardQueryParams();
  }

  /**
   * Accepts only same-origin relative paths (no scheme, no //), to avoid open redirects.
   */
  private safeReturnUrlFromRoute(): string | null {
    const raw = this.route.snapshot.queryParamMap.get('returnUrl');
    if (!raw || typeof raw !== 'string') {
      return null;
    }
    const trimmed = raw.trim();
    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
      return null;
    }
    if (trimmed.includes(':') || trimmed.includes('\\')) {
      return null;
    }
    if (!/^\/[a-zA-Z0-9/_-]*$/.test(trimmed)) {
      return null;
    }
    return trimmed;
  }

  private sendSaveWithConflictOverride(): void {
    const payloads = this.toPayloads();
    if (payloads.length === 0) {
      this.toast.error('אין הזמנות לשמירה');
      return;
    }

    this.submitting.set(true);

    from(payloads)
      .pipe(
        concatMap((basePayload) =>
          this.hasAnyBookingConflict(basePayload).pipe(
            switchMap((hasConflict) => {
              if (!hasConflict) {
                return this.sendSaveRequest(basePayload);
              }

              const confirmed = confirm('הציוד כבר תפוס ליום זה, האם להמשיך בכל זאת?');
              if (!confirmed) {
                return of(null);
              }

              return this.sendSaveRequest({
                ...basePayload,
                allowDoubleBooking: true
              });
            })
          )
        ),
        toArray(),
        finalize(() => this.submitting.set(false))
      )
      .subscribe({
        next: (results) => {
          const saved = results.filter((r): r is OrderDto => r !== null);
          if (saved.length === 0) {
            return;
          }

          const firstPayload = payloads[0]!;
          this.existingCustomerMatch.set(null);
          this.customers.upsertFromPayload({
            phone1: OrderFormComponent.digitsOnly(String(firstPayload.phone ?? '')),
            phone2:
              OrderFormComponent.digitsOnly(String(firstPayload.phone2 ?? '')).length > 0
                ? OrderFormComponent.digitsOnly(String(firstPayload.phone2 ?? ''))
                : null,
            fullName: firstPayload.customerName ?? null,
            address: firstPayload.address ?? null
          });

          const id = this.editingId();
          if (id !== null) {
            this.toast.success('ההזמנה עודכנה בהצלחה');
          } else if (saved.length === 1) {
            this.toast.success('ההזמנה נשמרה בהצלחה');
          } else if (saved.length === payloads.length) {
            this.toast.success(`${saved.length} הזמנות נשמרו בהצלחה`);
          } else {
            this.toast.warning(`נשמרו ${saved.length} מתוך ${payloads.length} הזמנות`);
          }

          for (const order of saved) {
            this.ordersSync.notifyOrderUpdated(order);
          }

          this.inventoryStore.load({ force: true }).subscribe();

          this.orderDraft.clearIfKind('sound-order');

          const navigateDate =
            saved[0]?.shifts?.[0]?.orderDate ?? firstPayload.shifts?.[0]?.orderDate ?? null;
          this.navigateAfterOrderFlow(navigateDate);
        }
      });
  }

  private sendSaveRequest(payload: OrderCreateUpdateDto) {
    const id = this.editingId();
    return id !== null
      ? this.data.updateOrder(id, payload)
      : this.data.createOrder(payload);
  }

  private hasAnyBookingConflict(payload: OrderCreateUpdateDto) {
    const equipmentIds = payload.equipmentDefinitionIds ?? [];
    const shifts = payload.shifts ?? [];
    if (equipmentIds.length === 0 || shifts.length === 0) {
      return of(false);
    }

    const excludeOrderId = this.editingId() ?? undefined;
    return this.data.getEquipmentAvailability(shifts, excludeOrderId).pipe(
      map((items) => {
        const occupied = new Set(items.filter((item) => item.isOccupied).map((item) => item.id));
        return equipmentIds.some((id) => occupied.has(id));
      })
    );
  }

  protected clearForm(): void {
    const todayIso = this.toIso(new Date());
    const todayParts = this.hebrew.toHebrewParts(new Date());

    while (this.bookings.length > 1) {
      this.bookings.removeAt(this.bookings.length - 1);
    }
    this.bookingUi.set([]);
    this.ensureBookingUi(0);

    const booking = this.bookingGroup(0);
    booking.reset({
      equipmentDefinitionIds: [],
      startDate: todayIso,
      startShift: TimeSlot.Morning,
      endDate: todayIso,
      endShift: TimeSlot.Morning,
      orderDate: todayIso,
      startHebrewYear: todayParts.year,
      startHebrewMonth: todayParts.month,
      startHebrewDay: todayParts.day,
      endHebrewYear: todayParts.year,
      endHebrewMonth: todayParts.month,
      endHebrewDay: todayParts.day,
      returnTimeType: ReturnTimeType.LateNight,
      customReturnTime: ''
    });
    this.syncEndpointHebrewSignals(0, 'start');
    this.syncEndpointHebrewSignals(0, 'end');
    this.syncHebrewEndpointToIso(0, 'start', false);
    this.syncHebrewEndpointToIso(0, 'end', false);
    this.shiftsArray(0).clear();
    this.syncShiftsFromRange(0);

    this.form.patchValue({
      customerName: '',
      phone: '',
      phone2: '',
      address: '',
      institutionName: '',
      institutionId: null,
      depositType: null,
      depositOnName: '',
      paymentAmount: null,
      isUnpaid: false,
      notes: ''
    });

    while (this.equipmentList.length > 0) {
      this.equipmentList.removeAt(0);
    }
    this.addAccessoryOpen.set(false);
    this.accessoryTypeQuery.set('');
    this.accessorySerialDropdownRow.set(null);
    this.accessorySerialQuickEntry.set('');
    this.existingCustomerMatch.set(null);
    this.closeCustomerSuggestions();
    this.institutionConflict.set(null);
    this.toast.show('הטופס נוקה', 'info');
  }

  protected delete(): void {
    const id = this.editingId();
    if (id === null) return;
    if (!confirm('למחוק את ההזמנה? לא ניתן לשחזר פעולה זו.')) return;

    this.submitting.set(true);
    this.data
      .deleteOrder(id)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (ok) => {
          if (!ok) {
            return;
          }
          this.toast.success('ההזמנה נמחקה בהצלחה');
          const iso = this.bookingGroup(0).controls['startDate'].value;
          this.navigateAfterOrderFlow(typeof iso === 'string' ? iso : null);
        }
      });
  }

  protected cancel(): void {
    const id = this.editingId();
    if (id === null || this.orderCancelled()) {
      return;
    }
    if (!confirm('לבטל את ההזמנה? המשבצות בלוח השבועי יתפנו מיד.')) {
      return;
    }

    this.submitting.set(true);
    this.data
      .cancelOrder(id)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (order) => {
          if (order === null) {
            return;
          }
          this.toast.success('ההזמנה בוטלה בהצלחה');
          const iso = this.bookingGroup(0).controls['startDate'].value;
          this.navigateAfterOrderFlow(typeof iso === 'string' ? iso : null);
        }
      });
  }

  protected openReturnModal(): void {
    const order = this.loadedOrder();
    const id = this.editingId();
    if (!order || id === null || this.orderCancelled()) {
      return;
    }

    const rows: ReturnModalRow[] = (order.loanedEquipments ?? [])
      .filter((row) => row.quantity > 0 && row.id != null && row.id > 0)
      .map((row) => this.toReturnModalRow(row));

    if (rows.length === 0) {
      this.toast.show('אין ציוד מושאל להחזרה בהזמנה זו', 'info');
      return;
    }

    this.returnSerialDropdownRowId.set(null);
    this.returnRows.set(rows);
    this.returnModalOpen.set(true);
  }

  /** Build a return-modal row, hydrating any previously recorded returns. */
  private toReturnModalRow(row: OrderLoanedEquipmentDto): ReturnModalRow {
    const assignedSerialCodes = (row.notes ?? [])
      .map((n) => (n.content ?? '').trim())
      .filter((c) => c.length > 0);
    const isCustomItem = !!row.isCustomItem;
    const lockedReturnedSerialCodes = (row.notes ?? [])
      .filter((n) => n.isReturned && (n.content ?? '').trim().length > 0)
      .map((n) => (n.content ?? '').trim());
    const alreadyReturnedQuantity = Math.min(
      Math.max(row.returnedQuantity ?? 0, lockedReturnedSerialCodes.length),
      row.quantity
    );
    const returnedSerialCodes =
      assignedSerialCodes.length > 0 ? [...lockedReturnedSerialCodes] : [];
    const quantityReturned =
      assignedSerialCodes.length > 0
        ? returnedSerialCodes.length
        : alreadyReturnedQuantity;

    return {
      rowId: `line-${row.id}`,
      loanedEquipmentId: row.id!,
      label: isCustomItem
        ? (row.customItemName?.trim() || 'פריט נוסף')
        : row.loanedEquipmentType
          ? this.inventoryStore.displayLabelForType(row.loanedEquipmentType)
          : String(row.loanedEquipmentType),
      quantityLoaned: row.quantity,
      quantityReturned,
      isCustomItem,
      assignedSerialCodes,
      returnedSerialCodes,
      lockedReturnedSerialCodes,
      alreadyReturnedQuantity
    };
  }

  protected closeReturnModal(): void {
    if (this.returnSaving()) {
      return;
    }
    this.returnSerialDropdownRowId.set(null);
    this.returnModalOpen.set(false);
  }

  protected markAllReturned(): void {
    this.returnRows.update((rows) =>
      rows.map((row) => ({
        ...row,
        quantityReturned: row.quantityLoaned,
        returnedSerialCodes:
          row.assignedSerialCodes.length > 0 ? [...row.assignedSerialCodes] : []
      }))
    );
  }

  protected markRowAllReturned(index: number): void {
    this.returnRows.update((rows) =>
      rows.map((row, i) =>
        i === index
          ? {
              ...row,
              quantityReturned:
                row.assignedSerialCodes.length > 0
                  ? row.assignedSerialCodes.length
                  : row.quantityLoaned,
              returnedSerialCodes:
                row.assignedSerialCodes.length > 0 ? [...row.assignedSerialCodes] : []
            }
          : row
      )
    );
  }

  protected hasSerializedReturnCodes(row: ReturnModalRow): boolean {
    // Any loaned line with assigned codes (catalog or custom/one-time) uses code selection.
    return row.assignedSerialCodes.length > 0;
  }

  protected isReturnSerialLocked(row: ReturnModalRow, code: string): boolean {
    return row.lockedReturnedSerialCodes.some(
      (c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
    );
  }

  protected toggleReturnSerialDropdown(row: ReturnModalRow): void {
    const key = row.rowId;
    this.returnSerialDropdownRowId.update((cur) => (cur === key ? null : key));
  }

  protected isReturnSerialDropdownOpen(row: ReturnModalRow): boolean {
    return this.returnSerialDropdownRowId() === row.rowId;
  }

  protected isReturnSerialSelected(row: ReturnModalRow, code: string): boolean {
    return row.returnedSerialCodes.some(
      (c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
    );
  }

  protected toggleReturnSerialSelection(row: ReturnModalRow, code: string, checked: boolean): void {
    if (!checked && this.isReturnSerialLocked(row, code)) {
      return;
    }

    this.returnRows.update((rows) =>
      rows.map((current) => {
        if (current.rowId !== row.rowId) {
          return current;
        }

        let returnedSerialCodes = [...current.returnedSerialCodes];
        if (checked) {
          if (
            !returnedSerialCodes.some(
              (c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
            )
          ) {
            returnedSerialCodes.push(code);
          }
        } else {
          returnedSerialCodes = returnedSerialCodes.filter(
            (c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) !== 0
          );
        }

        // Keep locked (already returned) codes selected.
        for (const locked of current.lockedReturnedSerialCodes) {
          if (
            !returnedSerialCodes.some(
              (c) => c.localeCompare(locked, undefined, { sensitivity: 'accent' }) === 0
            )
          ) {
            returnedSerialCodes.push(locked);
          }
        }

        return {
          ...current,
          returnedSerialCodes,
          quantityReturned: returnedSerialCodes.length
        };
      })
    );
  }

  protected returnSerialSummary(row: ReturnModalRow): string {
    if (row.returnedSerialCodes.length === 0) {
      return 'בחרו פריטים שהוחזרו';
    }
    return row.returnedSerialCodes.join(', ');
  }

  protected updateReturnQuantity(index: number, raw: string): void {
    const parsed = Number.parseInt(raw, 10);
    const value = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    this.returnRows.update((rows) =>
      rows.map((row, i) => {
        if (i !== index) {
          return row;
        }

        const quantityReturned = Math.min(
          Math.max(value, row.alreadyReturnedQuantity),
          row.quantityLoaned
        );
        if (!this.hasSerializedReturnCodes(row)) {
          return { ...row, quantityReturned };
        }

        const returnedSerialCodes = row.assignedSerialCodes.slice(0, quantityReturned);
        return { ...row, quantityReturned, returnedSerialCodes };
      })
    );
  }

  protected missingReturnCount(row: ReturnModalRow): number {
    return Math.max(0, row.quantityLoaned - row.quantityReturned);
  }

  protected loanedEquipmentLabel(row: OrderLoanedEquipmentDto): string {
    if (row.isCustomItem) {
      return row.customItemName?.trim() || 'פריט נוסף';
    }
    if (row.loanedEquipmentType) {
      return this.inventoryStore.displayLabelForType(row.loanedEquipmentType);
    }
    return String(row.loanedEquipmentType);
  }

  protected saveReturn(): void {
    const id = this.editingId();
    if (id === null || this.returnSaving()) {
      return;
    }

    const rows = this.returnRows();
    if (rows.length === 0) {
      this.toast.error('אין פריטים להחזרה');
      return;
    }

    const request: OrderReturnRequestDto = {
      items: rows.map((row) => ({
        loanedEquipmentId: row.loanedEquipmentId,
        quantityReturned: row.quantityReturned,
        returnedSerialCodes: this.hasSerializedReturnCodes(row) ? row.returnedSerialCodes : []
      }))
    };

    this.returnSaving.set(true);
    this.data
      .recordOrderReturn(id, request)
      .pipe(finalize(() => this.returnSaving.set(false)))
      .subscribe({
        next: (updated) => {
          if (updated === null) {
            return;
          }
          this.loadedOrder.set(updated);
          this.syncReturnedSerialState(updated);
          this.ordersSync.notifyOrderUpdated(updated);
          this.refreshAccessorySerialAvailability();
          this.returnModalOpen.set(false);
          this.toast.success('ההחזרה נשמרה בהצלחה');
        }
      });
  }

  // -----------------------------------------------------------------
  // Form construction
  // -----------------------------------------------------------------

  private buildForm(): FormGroup {
    return this.fb.group({
      bookings: this.fb.array([this.buildBookingGroup()]),

      customerName: ['', Validators.maxLength(100)],
      phone: ['', [Validators.required, Validators.maxLength(20), israeliPhoneValidator()]],
      phone2: ['', [Validators.maxLength(20), optionalIsraeliPhoneValidator()]],
      address: ['', Validators.maxLength(200)],
      institutionName: ['', Validators.maxLength(200)],
      institutionId: [null as number | null],
      depositType: [null as DepositType | null],
      depositOnName: ['', Validators.maxLength(100)],
      paymentAmount: [null as number | null, [Validators.min(0)]],
      isUnpaid: [false],
      notes: ['', Validators.maxLength(1000)],

      loanedEquipments: this.fb.array<FormGroup>([])
    });
  }

  private buildBookingGroup(): FormGroup {
    const today = new Date();
    const todayIso = this.toIso(today);
    const parts = this.hebrew.toHebrewParts(today);

    return this.fb.group(
      {
        equipmentDefinitionIds: this.fb.nonNullable.control<string[]>([], Validators.required),
        startDate: this.fb.nonNullable.control<string>(todayIso, Validators.required),
        startShift: this.fb.nonNullable.control<TimeSlot>(TimeSlot.Morning, Validators.required),
        endDate: this.fb.nonNullable.control<string>(todayIso, Validators.required),
        endShift: this.fb.nonNullable.control<TimeSlot>(TimeSlot.Morning, Validators.required),
        orderDate: this.fb.nonNullable.control<string>(todayIso, Validators.required),
        shifts: this.fb.array([]),

        startHebrewYear: this.fb.nonNullable.control<number>(parts.year, Validators.required),
        startHebrewMonth: this.fb.nonNullable.control<number>(parts.month, Validators.required),
        startHebrewDay: this.fb.nonNullable.control<number>(parts.day, Validators.required),
        endHebrewYear: this.fb.nonNullable.control<number>(parts.year, Validators.required),
        endHebrewMonth: this.fb.nonNullable.control<number>(parts.month, Validators.required),
        endHebrewDay: this.fb.nonNullable.control<number>(parts.day, Validators.required),

        returnTimeType: this.fb.nonNullable.control<ReturnTimeType>(ReturnTimeType.LateNight, Validators.required),
        customReturnTime: ['', Validators.maxLength(20)]
      },
      {
        // Wrap in an arrow at the call site so `this` is bound when Angular
        // invokes the validator. The validator itself must be a *method*
        // (not an instance-field arrow) because `buildForm()` / `buildBookingGroup()`
        // run during field initialization — before any later instance-field arrow
        // properties have been assigned — so referencing one of those would
        // pass `undefined` to Angular and crash with
        // "Cannot read properties of undefined (reading 'validate')".
        validators: [
          (group: AbstractControl) => this.orderDateNotInPastValidator(group),
          (group: AbstractControl) => this.rangeOrderValidator(group),
          (group: AbstractControl) => this.shiftsRequiredValidator(group),
          (group: AbstractControl) => this.selectedShiftsNotInPastValidator(group),
          (group: AbstractControl) => this.selectedShiftsAllowedValidator(group),
          (group: AbstractControl) => this.selectedShiftsBlockedValidator(group),
          (group: AbstractControl) => this.returnTimeValidator(group)
        ]
      }
    );
  }

  private emptyBookingUi(parts?: HebrewDateParts): BookingUiState {
    const p = parts ?? this.hebrew.toHebrewParts(new Date());
    return {
      occupiedById: {},
      slotTaken: false,
      equipmentDropdownOpen: false,
      startHebrewYear: p.year,
      startHebrewMonth: p.month,
      startHebrewDay: p.day,
      endHebrewYear: p.year,
      endHebrewMonth: p.month,
      endHebrewDay: p.day
    };
  }

  private ensureBookingUi(index: number): void {
    this.bookingUi.update((states) => {
      const next = [...states];
      while (next.length <= index) {
        next.push(this.emptyBookingUi());
      }
      return next;
    });
  }

  private patchBookingUi(index: number, patch: Partial<BookingUiState>): void {
    this.ensureBookingUi(index);
    this.bookingUi.update((states) => {
      const next = [...states];
      next[index] = { ...next[index]!, ...patch };
      return next;
    });
  }

  private wireBookingGroup(index: number): void {
    const booking = this.bookingGroup(index);
    this.wireHebrewEndpointSync(booking, 'start');
    this.wireHebrewEndpointSync(booking, 'end');
    this.wireRangeSync(booking);

    this.equipmentIdsControl(index)
      .valueChanges.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        const bi = this.bookings.controls.indexOf(booking);
        if (bi < 0) {
          return;
        }
        this.refreshSlotTakenWarning(bi);
      });
  }

  // -----------------------------------------------------------------
  // Validators
  // -----------------------------------------------------------------

  private static digitsOnly(raw: string): string {
    return raw.replace(/\D/g, '');
  }

  /**
   * Form-level validator that prevents saving an order for a date that has
   * already passed. Comparison is done against today's local Gregorian date,
   * using the auto-synced `orderDate` ISO value (which mirrors the Hebrew
   * Day / Month / Year dropdowns).
   *
   * NOTE: This is intentionally a regular (prototype) method, not an
   * instance-field arrow, so it is callable from `buildForm()` during the
   * `form = this.buildForm()` field initializer.
   */
  private orderDateNotInPastValidator(group: AbstractControl): ValidationErrors | null {
    if (this.editingId() !== null) {
      return null;
    }
    const dates = [group.get('startDate')?.value, group.get('endDate')?.value]
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (dates.length === 0) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const iso of dates) {
      const selected = this.hebrew.parseIso(iso);
      if (!selected) continue;
      selected.setHours(0, 0, 0, 0);
      if (selected.getTime() < today.getTime()) {
        return { orderDateInPast: true };
      }
    }

    return null;
  }

  private rangeOrderValidator(group: AbstractControl): ValidationErrors | null {
    const startDate = group.get('startDate')?.value as string | undefined;
    const endDate = group.get('endDate')?.value as string | undefined;
    const startShift = group.get('startShift')?.value as TimeSlot | undefined;
    const endShift = group.get('endShift')?.value as TimeSlot | undefined;
    if (!startDate || !endDate || startShift == null || endShift == null) {
      return null;
    }
    return this.compareShiftEndpoints(startDate, startShift, endDate, endShift) <= 0
      ? null
      : { rangeInvalid: true };
  }

  private shiftsRequiredValidator(group: AbstractControl): ValidationErrors | null {
    const shifts = group.get('shifts') as FormArray | null;
    return shifts && shifts.length > 0 ? null : { shiftsRequired: true };
  }

  private selectedShiftsNotInPastValidator(group: AbstractControl): ValidationErrors | null {
    if (this.editingId() !== null) {
      return null;
    }
    const shifts = (group.get('shifts') as FormArray | null)?.getRawValue() as OrderShiftDto[] | undefined;
    if (!shifts || shifts.length === 0) {
      return null;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const shift of shifts) {
      const d = this.hebrew.parseIso(shift.orderDate);
      if (!d) {
        continue;
      }
      d.setHours(0, 0, 0, 0);
      if (d.getTime() < today.getTime()) {
        return { selectedShiftInPast: true };
      }
    }
    return null;
  }

  /**
   * Friday (JS weekday 5) → Morning only; Saturday (6) → Evening only.
   * Keeps the form invalid if `timeSlot` and `orderDate` disagree (e.g. tampering or timing edge cases).
   */
  private selectedShiftsAllowedValidator(group: AbstractControl): ValidationErrors | null {
    const shifts = (group.get('shifts') as FormArray | null)?.getRawValue() as OrderShiftDto[] | undefined;
    if (!shifts || shifts.length === 0) {
      return null;
    }
    for (const shift of shifts) {
      const d = this.hebrew.parseIso(shift.orderDate);
      if (!d) {
        continue;
      }
      const dow = d.getDay();
      if (dow === 5 && shift.timeSlot !== TimeSlot.Morning) {
        return { shiftNotAllowedForDate: true };
      }
      if (dow === 6 && shift.timeSlot !== TimeSlot.Evening) {
        return { shiftNotAllowedForDate: true };
      }
    }
    return null;
  }

  private selectedShiftsBlockedValidator(group: AbstractControl): ValidationErrors | null {
    if (this.editingId() !== null) {
      return null;
    }

    const shifts = (group.get('shifts') as FormArray | null)?.getRawValue() as OrderShiftDto[] | undefined;
    if (!shifts || shifts.length === 0) {
      return null;
    }

    const blocks = this.blockedDatesSig();
    for (const shift of shifts) {
      const block = findBlockedDateForIso(shift.orderDate, blocks);
      if (block) {
        return { shiftBlocked: true, blockedReason: block.reason ?? null };
      }
    }

    return null;
  }

  private returnTimeValidator(group: AbstractControl): ValidationErrors | null {
    const type = group.get('returnTimeType')?.value as ReturnTimeType | undefined;
    const custom = group.get('customReturnTime')?.value;
    if (type !== ReturnTimeType.SpecificTime) {
      return null;
    }
    return typeof custom === 'string' && custom.trim().length > 0
      ? null
      : { returnTimeRequired: true };
  }

  // -----------------------------------------------------------------
  // Hebrew ↔ Gregorian sync
  // -----------------------------------------------------------------

  /**
   * Fetches equipment occupancy for booking shift ranges and
   * updates the dropdown badges plus the duplicate-booking warning bar.
   */
  private wireEquipmentAvailability(): void {
    this.availabilityFetchTrigger$
      .pipe(
        groupBy((bookingIndex) => bookingIndex),
        mergeMap((group$) =>
          group$.pipe(
            debounceTime(200),
            switchMap((bookingIndex) =>
              this.loadEquipmentAvailability(bookingIndex).pipe(
                map((occupied) => ({ bookingIndex, occupied }))
              )
            )
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ bookingIndex, occupied }) => {
        if (bookingIndex < 0 || bookingIndex >= this.bookings.length) {
          return;
        }
        this.patchBookingUi(bookingIndex, { occupiedById: occupied });
        this.refreshSlotTakenWarning(bookingIndex);
      });
  }

  private wireInstitutionConflictCheck(): void {
    const institutionNameCtrl = this.form.controls['institutionName'];
    const institutionIdCtrl = this.form.controls['institutionId'];
    merge(
      institutionNameCtrl.valueChanges.pipe(startWith(institutionNameCtrl.value)),
      institutionIdCtrl.valueChanges.pipe(startWith(institutionIdCtrl.value)),
      this.institutionConflictTrigger$
    )
      .pipe(
        debounceTime(300),
        switchMap(() => this.loadInstitutionConflict()),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => this.institutionConflict.set(result));
  }

  private wireInstitutionAutocomplete(): void {
    this.form.controls['institutionName'].valueChanges
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((raw) => {
          const q = String(raw ?? '').trim();
          // Typing freely clears a previously selected institution id until re-selected.
          const currentId = this.form.controls['institutionId'].value as number | null;
          if (currentId != null) {
            const selected = this.institutionSuggestions().find((i) => i.id === currentId);
            if (!selected || selected.name !== q) {
              this.form.controls['institutionId'].setValue(null, { emitEvent: false });
            }
          }
          if (q.length === 0) {
            this.institutionSuggestions.set([]);
            this.institutionSuggestOpen.set(false);
            return of([] as InstitutionDto[]);
          }
          return this.data.searchInstitutions(q);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((list) => {
        this.institutionSuggestions.set(list);
        this.institutionSuggestIndex.set(list.length > 0 ? 0 : -1);
        this.institutionSuggestOpen.set(list.length > 0);
      });
  }

  protected onInstitutionSuggestFocus(): void {
    if (this.institutionSuggestBlurTimer) {
      clearTimeout(this.institutionSuggestBlurTimer);
      this.institutionSuggestBlurTimer = null;
    }
    const q = String(this.form.controls['institutionName'].value ?? '').trim();
    if (q.length > 0 && this.institutionSuggestions().length > 0) {
      this.institutionSuggestOpen.set(true);
    }
  }

  protected onInstitutionSuggestBlur(): void {
    this.institutionSuggestBlurTimer = setTimeout(() => {
      this.institutionSuggestOpen.set(false);
      this.institutionSuggestIndex.set(-1);
    }, 150);
  }

  protected onInstitutionSuggestKeydown(event: KeyboardEvent): void {
    if (!this.institutionSuggestOpen() || this.institutionSuggestions().length === 0) {
      return;
    }
    const list = this.institutionSuggestions();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.institutionSuggestIndex.update((i) => (i + 1) % list.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.institutionSuggestIndex.update((i) => (i <= 0 ? list.length - 1 : i - 1));
    } else if (event.key === 'Enter') {
      const idx = this.institutionSuggestIndex();
      const pick = idx >= 0 ? list[idx] : null;
      if (pick) {
        event.preventDefault();
        this.selectInstitutionSuggestion(pick);
      }
    } else if (event.key === 'Escape') {
      this.institutionSuggestOpen.set(false);
    }
  }

  protected selectInstitutionSuggestion(inst: InstitutionDto, event?: Event): void {
    event?.preventDefault();
    this.form.patchValue(
      {
        institutionName: inst.name,
        institutionId: inst.id
      },
      { emitEvent: false }
    );
    this.institutionSuggestions.set([]);
    this.institutionSuggestOpen.set(false);
    this.institutionSuggestIndex.set(-1);
    this.institutionConflictTrigger$.next();
  }

  private loadInstitutionConflict() {
    const institutionId = this.form.controls['institutionId'].value as number | null;
    const institutionName = String(this.form.controls['institutionName'].value ?? '').trim();
    const dates = this.orderReservationDates();
    if ((!institutionId && !institutionName) || dates.length === 0) {
      return of(null);
    }

    const excludeId = this.editingId() ?? undefined;
    return from(dates).pipe(
      concatMap((date) =>
        this.data.checkInstitutionConflict(institutionName || null, date, excludeId, institutionId)
      ),
      map((result) => (result.hasConflict ? result : null)),
      toArray(),
      map((results) => results.find((r) => r != null) ?? null)
    );
  }

  protected institutionConflictMessage(conflict: InstitutionConflictDto): string {
    const customer = (conflict.conflictingCustomerName ?? '').trim() || 'לקוח אחר';
    const note = (conflict.institutionNote ?? '').trim() || 'אין';
    return `שים לב! קיימת כבר הזמנה באותו יום עבור מוסד זה על ידי ${customer}. הערה מיוחדת למוסד: ${note}`;
  }

  private loadEquipmentAvailability(bookingIndex: number) {
    const shifts = this.selectedShiftRows(bookingIndex);
    if (shifts.length === 0) {
      return of({});
    }

    const excludeId = this.editingId() ?? undefined;
    return this.data.getEquipmentAvailability(shifts, excludeId).pipe(
      map((items) => this.toOccupiedMap(items))
    );
  }

  private toOccupiedMap(items: EquipmentDefinitionAvailabilityDto[]): Record<string, boolean> {
    const map: Record<string, boolean> = {};
    for (const item of items) {
      map[item.id] = item.isOccupied;
    }
    return map;
  }

  private refreshSlotTakenWarning(bookingIndex: number): void {
    const occupied = this.bookingUi()[bookingIndex]?.occupiedById ?? {};
    const selected = this.equipmentIdsControl(bookingIndex).value ?? [];
    this.patchBookingUi(bookingIndex, {
      slotTaken: selected.some((id) => occupied[id] === true)
    });
  }

  private wireRangeSync(booking: FormGroup): void {
    const controls = [
      booking.controls['startDate'],
      booking.controls['startShift'],
      booking.controls['endDate'],
      booking.controls['endShift']
    ];
    for (const control of controls) {
      control.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => {
          if (this.suppressRangeSync) {
            return;
          }
          const bi = this.bookings.controls.indexOf(booking);
          if (bi < 0) {
            return;
          }
          this.syncShiftsFromRange(bi);
        });
    }
    const bi = this.bookings.controls.indexOf(booking);
    if (bi >= 0) {
      this.syncShiftsFromRange(bi);
    }
  }

  private syncShiftsFromRange(bookingIndex: number): void {
    const booking = this.bookingGroup(bookingIndex);
    const startDate = booking.controls['startDate'].value as string;
    const endDate = booking.controls['endDate'].value as string;
    let startShift = booking.controls['startShift'].value as TimeSlot;
    let endShift = booking.controls['endShift'].value as TimeSlot;
    const startAllowed = this.availableTimeSlots(startDate);
    const endAllowed = this.availableTimeSlots(endDate);
    if (!startAllowed.includes(startShift)) {
      startShift = startAllowed[0] ?? TimeSlot.Morning;
      booking.controls['startShift'].setValue(startShift, { emitEvent: false });
    }
    if (!endAllowed.includes(endShift)) {
      endShift = endAllowed[endAllowed.length - 1] ?? TimeSlot.Evening;
      booking.controls['endShift'].setValue(endShift, { emitEvent: false });
    }
    endShift = this.coerceEndShiftForRange(startDate, startShift, endDate, endShift);
    if (endShift !== booking.controls['endShift'].value) {
      booking.controls['endShift'].setValue(endShift, { emitEvent: false });
    }
    const shifts = this.generateContinuousShifts(startDate, startShift, endDate, endShift);

    const shiftsFa = this.shiftsArray(bookingIndex);
    shiftsFa.clear({ emitEvent: false });
    for (const shift of shifts) {
      shiftsFa.push(this.fb.group({
        orderDate: this.fb.nonNullable.control(shift.orderDate),
        timeSlot: this.fb.nonNullable.control(shift.timeSlot)
      }), { emitEvent: false });
    }
    booking.controls['orderDate'].setValue(startDate, { emitEvent: false });
    booking.updateValueAndValidity({ emitEvent: false });
    this.availabilityFetchTrigger$.next(bookingIndex);
    this.institutionConflictTrigger$.next();
    this.refreshAccessorySerialAvailability();
  }

  private orderReservationDates(): string[] {
    const dates = new Set<string>();
    const bookingCount = this.isEdit() ? 1 : this.bookings.length;
    for (let i = 0; i < bookingCount; i++) {
      for (const shift of this.selectedShiftRows(i)) {
        if (shift.orderDate) {
          dates.add(shift.orderDate);
        }
      }
    }
    return [...dates].sort();
  }

  private wireAccessorySerialAvailability(): void {
    this.availabilityFetchTrigger$
      .pipe(debounceTime(200), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshAccessorySerialAvailability());
  }

  private refreshAccessorySerialAvailability(): void {
    const dates = this.orderReservationDates();
    if (dates.length === 0) {
      this.accessoryAvailabilityByType.set(new Map());
      return;
    }

    const excludeOrderId = this.editingId();
    this.data
      .getAccessorySerialAvailability({
        dates,
        excludeOrderId: excludeOrderId ?? null
      })
      .subscribe((groups) => {
        const map = new Map<LoanedEquipmentType, AccessorySerialOptionDto[]>();
        for (const group of groups) {
          map.set(group.equipmentType, group.options);
        }
        this.accessoryAvailabilityByType.set(map);
      });
  }

  private generateContinuousShifts(
    startDate: string,
    startShift: TimeSlot,
    endDate: string,
    endShift: TimeSlot
  ): OrderShiftDto[] {
    if (!startDate || !endDate || startShift == null || endShift == null) {
      return [];
    }
    if (this.compareShiftEndpoints(startDate, startShift, endDate, endShift) > 0) {
      return [];
    }

    const start = this.hebrew.parseIso(startDate);
    const end = this.hebrew.parseIso(endDate);
    if (!start || !end) {
      return [];
    }

    const shifts: OrderShiftDto[] = [];
    for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
      const iso = this.toIso(d);
      for (const timeSlot of this.availableTimeSlots(iso)) {
        if (
          this.compareShiftEndpoints(iso, timeSlot, startDate, startShift) >= 0 &&
          this.compareShiftEndpoints(iso, timeSlot, endDate, endShift) <= 0
        ) {
          shifts.push({ orderDate: iso, timeSlot });
        }
      }
    }
    return shifts;
  }

  private compareShiftEndpoints(
    aDate: string,
    aShift: TimeSlot,
    bDate: string,
    bShift: TimeSlot
  ): number {
    const byDate = aDate.localeCompare(bDate);
    if (byDate !== 0) {
      return byDate;
    }
    return this.shiftOrder(aShift) - this.shiftOrder(bShift);
  }

  private shiftOrder(slot: TimeSlot): number {
    return slot === TimeSlot.Morning ? 1 : 2;
  }

  /**
   * When start/end share a date, end shift must not precede start shift
   * (e.g. evening start with morning end on the same day).
   */
  private coerceEndShiftForRange(
    startDate: string,
    startShift: TimeSlot,
    endDate: string,
    endShift: TimeSlot
  ): TimeSlot {
    if (this.compareShiftEndpoints(startDate, startShift, endDate, endShift) <= 0) {
      return endShift;
    }

    const endAllowed = this.availableTimeSlots(endDate);
    if (endAllowed.includes(startShift)) {
      return startShift;
    }

    const notBeforeStart = endAllowed.filter(
      (slot) => this.shiftOrder(slot) >= this.shiftOrder(startShift)
    );
    if (notBeforeStart.length > 0) {
      return notBeforeStart[notBeforeStart.length - 1]!;
    }

    return endAllowed[endAllowed.length - 1] ?? startShift;
  }

  private coerceEndShiftToValidRange(bookingIndex: number, emitEvent: boolean): void {
    const booking = this.bookingGroup(bookingIndex);
    const startDate = booking.controls['startDate'].value as string;
    const endDate = booking.controls['endDate'].value as string;
    const startShift = booking.controls['startShift'].value as TimeSlot;
    const endShift = booking.controls['endShift'].value as TimeSlot;
    const coerced = this.coerceEndShiftForRange(startDate, startShift, endDate, endShift);
    if (coerced !== endShift) {
      booking.controls['endShift'].setValue(coerced, { emitEvent });
    }
  }

  /**
   * Debounced typeahead on Name / Phone1 via lean suggest API.
   * Also sets existingCustomerMatch when Phone1 is a valid Israeli number (single HTTP call).
   */
  private wireCustomerAutocomplete(): void {
    const name$ = this.form.controls['customerName'].valueChanges.pipe(
      map((v) => ({ field: 'name' as const, q: String(v ?? '').trim() }))
    );
    const phone$ = this.form.controls['phone'].valueChanges.pipe(
      tap((v) =>
        this.phone1DigitsSig.set(OrderFormComponent.digitsOnly(String(v ?? '')))
      ),
      map((v) => ({ field: 'phone' as const, q: String(v ?? '').trim() }))
    );

    merge(name$, phone$)
      .pipe(
        debounceTime(300),
        switchMap(({ field, q }) => {
          if (q.length < 2) {
            this.closeCustomerSuggestions();
            if (field === 'phone') {
              this.existingCustomerMatch.set(null);
            }
            return EMPTY;
          }
          return this.customers.searchSuggest(q).pipe(
            map((list) => ({
              field,
              q,
              list: list.slice(0, OrderFormComponent.CUSTOMER_SUGGEST_LIMIT)
            }))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ field, q, list }) => {
        const current =
          field === 'name'
            ? String(this.form.controls['customerName'].value ?? '').trim()
            : String(this.form.controls['phone'].value ?? '').trim();
        if (current !== q) {
          return;
        }

        if (field === 'phone') {
          const digits = OrderFormComponent.digitsOnly(q);
          if (isValidIsraeliPhone(digits)) {
            const hit = list.find(
              (c) => c.phone1 === digits || (!!c.phone2 && c.phone2 === digits)
            );
            this.existingCustomerMatch.set(
              hit && !this.customerFieldsAlreadyMatch(hit) ? hit : null
            );
          } else {
            this.existingCustomerMatch.set(null);
          }
        }

        if (list.length === 0) {
          this.closeCustomerSuggestions();
          return;
        }
        this.customerSuggestField.set(field);
        this.customerSuggestions.set(list);
        this.customerSuggestIndex.set(0);
        this.customerSuggestOpen.set(true);
      });
  }

  /**
   * Watches Name / Phone1 and loads unresolved forgotten-equipment rows for this customer.
   * Matches primarily by phone digits; falls back to exact customer-name match when phone is empty.
   */
  private wireLostEquipmentAlertLookup(): void {
    const name$ = this.form.controls['customerName'].valueChanges.pipe(
      startWith(this.form.controls['customerName'].value),
      map((v) => String(v ?? '').trim())
    );
    const phone$ = this.form.controls['phone'].valueChanges.pipe(
      startWith(this.form.controls['phone'].value),
      map((v) => OrderFormComponent.digitsOnly(String(v ?? '')))
    );

    merge(
      name$.pipe(map((customerName) => ({ customerName, phone: OrderFormComponent.digitsOnly(String(this.form.controls['phone'].value ?? '')) }))),
      phone$.pipe(map((phone) => ({ phone, customerName: String(this.form.controls['customerName'].value ?? '').trim() })))
    )
      .pipe(
        debounceTime(350),
        distinctUntilChanged(
          (a, b) => a.phone === b.phone && a.customerName === b.customerName
        ),
        switchMap(({ phone, customerName }) => this.loadActiveLostEquipment$(phone, customerName)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((matches) => this.activeLostEquipment.set(matches));
  }

  private loadActiveLostEquipment$(phoneDigits: string, customerName: string) {
    if (phoneDigits.length < 7 && customerName.length < 2) {
      this.activeLostEquipment.set([]);
      return EMPTY;
    }
    return this.data.getLostEquipment().pipe(
      map((list) => this.filterActiveLostForCustomer(list, phoneDigits, customerName))
    );
  }

  /** Re-check after silent form patches (order load / customer fill use emitEvent: false). */
  private refreshLostEquipmentAlert(): void {
    const phone = OrderFormComponent.digitsOnly(String(this.form.controls['phone'].value ?? ''));
    const customerName = String(this.form.controls['customerName'].value ?? '').trim();
    this.loadActiveLostEquipment$(phone, customerName).subscribe({
      next: (matches) => this.activeLostEquipment.set(matches),
      error: () => this.activeLostEquipment.set([])
    });
  }

  private filterActiveLostForCustomer(
    list: LostEquipmentDto[],
    phoneDigits: string,
    customerName: string
  ): LostEquipmentDto[] {
    return list.filter((row) => {
      if (!LOST_EQUIPMENT_ACTIVE_STATUSES.has(row.status)) {
        return false;
      }
      const rowPhone = OrderFormComponent.digitsOnly(row.phone ?? '');
      if (phoneDigits.length >= 7 && rowPhone.length > 0 && rowPhone === phoneDigits) {
        return true;
      }
      // Legacy rows (no phone) or forms without a valid phone: match by exact name.
      if (customerName.length >= 2 && row.customerName.trim() === customerName) {
        if (rowPhone.length === 0 || phoneDigits.length < 7) {
          return true;
        }
      }
      return false;
    });
  }

  protected openUnreturnedReportModal(): void {
    const customerName = String(this.form.controls['customerName'].value ?? '').trim();
    const phone = String(this.form.controls['phone'].value ?? '').trim();
    const address = String(this.form.controls['address'].value ?? '').trim();
    if (!customerName && !phone) {
      this.toast.error('יש למלא שם או טלפון של הלקוח לפני הדיווח');
      return;
    }

    this.unreturnedReportForm.reset({
      customerName,
      phone,
      address,
      isCustomItem: false,
      inventoryDefinitionId: null,
      customItemName: '',
      itemCode: ''
    });
    this.unreturnedReportOpen.set(true);
  }

  protected closeUnreturnedReportModal(): void {
    this.unreturnedReportOpen.set(false);
    this.unreturnedReportForm.reset({
      customerName: '',
      phone: '',
      address: '',
      isCustomItem: false,
      inventoryDefinitionId: null,
      customItemName: '',
      itemCode: ''
    });
  }

  protected onUnreturnedCustomItemToggle(): void {
    const checked = this.unreturnedReportForm.controls.isCustomItem.value === true;
    if (checked) {
      this.unreturnedReportForm.patchValue({ inventoryDefinitionId: null });
      this.unreturnedReportForm.controls.inventoryDefinitionId.setErrors(null);
    } else {
      this.unreturnedReportForm.patchValue({ customItemName: '' });
      this.unreturnedReportForm.controls.customItemName.setErrors(null);
    }
  }

  protected unreturnedItemOptionLabel(def: InventoryDefinitionDto): string {
    return def.displayName?.trim() || `פריט #${def.id}`;
  }

  protected submitUnreturnedReport(): void {
    const isCustom = this.unreturnedReportForm.controls.isCustomItem.value === true;
    const catalogCtrl = this.unreturnedReportForm.controls.inventoryDefinitionId;
    const customCtrl = this.unreturnedReportForm.controls.customItemName;

    if (isCustom) {
      catalogCtrl.setErrors(null);
      const customName = (customCtrl.value ?? '').trim();
      if (!customName) {
        customCtrl.setErrors({ required: true });
      }
    } else {
      customCtrl.setErrors(null);
      if (catalogCtrl.value == null) {
        catalogCtrl.setErrors({ required: true });
      }
    }

    if (this.unreturnedReportForm.invalid) {
      this.unreturnedReportForm.markAllAsTouched();
      this.toast.error('אנא מלאו את השדות הנדרשים');
      return;
    }
    if (this.unreturnedReportSaving()) {
      return;
    }

    const v = this.unreturnedReportForm.getRawValue();
    const customerName = (v.customerName ?? '').trim();
    const phone = (v.phone ?? '').trim();
    if (!customerName && !phone) {
      this.toast.error('יש למלא שם או טלפון של הלקוח לפני הדיווח');
      return;
    }

    let inventoryDefinitionId: number | null = null;
    let loanedEquipmentType: LoanedEquipmentType | null = null;
    let itemName: string | null = null;

    if (isCustom) {
      itemName = (v.customItemName ?? '').trim();
    } else {
      const definitionId = Number(v.inventoryDefinitionId);
      const def = this.unreturnedItemOptions().find((d) => d.id === definitionId);
      if (!def) {
        this.toast.error('יש לבחור פריט');
        return;
      }
      inventoryDefinitionId = def.id;
      loanedEquipmentType = (def.linkedEquipmentType as LoanedEquipmentType | null) ?? null;
      itemName = def.displayName;
    }

    const orderId = this.editingId();
    const itemCode = (v.itemCode ?? '').trim();

    this.unreturnedReportSaving.set(true);
    this.data
      .createManualUnreturnedItem({
        orderId: orderId != null && orderId > 0 ? orderId : null,
        customerName: customerName || null,
        phone: phone || null,
        address: (v.address ?? '').trim() || null,
        // Custom/one-time entries must never link to the permanent catalog.
        inventoryDefinitionId: isCustom ? null : inventoryDefinitionId,
        loanedEquipmentType: isCustom ? null : loanedEquipmentType,
        itemName,
        itemCode: itemCode || null
      })
      .pipe(finalize(() => this.unreturnedReportSaving.set(false)))
      .subscribe({
        next: (created: UnreturnedItemDto | null) => {
          if (!created) {
            return;
          }
          const row: UnreturnedItemDto = isCustom ? { ...created, isCustomItem: true } : created;
          this.ordersSync.notifyUnreturnedChanged(row);
          if (!isCustom) {
            this.inventoryStore.load({ force: true }).subscribe();
          }
          this.closeUnreturnedReportModal();
          this.toast.success(
            isCustom
              ? 'הפריט החד-פעמי נשמר בהשאלות פעילות ובפריטים שלא חזרו'
              : 'הדיווח נשמר — הפריט נוסף להשאלות פעילות ולרשימת פריטים שלא חזרו'
          );
        }
      });
  }

  /** True when name/address on the form already cover the matched directory row. */
  private customerFieldsAlreadyMatch(c: CustomerSuggestDto): boolean {
    const formName = String(this.form.controls['customerName'].value ?? '').trim();
    if (!formName) {
      return false;
    }
    const dirName = (c.fullName ?? '').trim();
    const formAddress = String(this.form.controls['address'].value ?? '').trim();
    const dirAddress = (c.address ?? '').trim();
    const nameMatches = !dirName || formName === dirName;
    const addressMatches = !formAddress || !dirAddress || formAddress === dirAddress;
    return nameMatches && addressMatches;
  }

  private toNonNegativeInteger(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  }

  private wireHebrewEndpointSync(booking: FormGroup, endpoint: 'start' | 'end'): void {
    const yearCtrl = booking.controls[`${endpoint}HebrewYear`];
    const monthCtrl = booking.controls[`${endpoint}HebrewMonth`];
    const dayCtrl = booking.controls[`${endpoint}HebrewDay`];

    const resolveIndex = (): number => this.bookings.controls.indexOf(booking);

    const bi0 = resolveIndex();
    if (bi0 >= 0) {
      this.syncEndpointHebrewSignals(bi0, endpoint);
      this.ensureYearInOptions(Number(yearCtrl.value));
      this.syncHebrewEndpointToIso(bi0, endpoint, false);
    }

    yearCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((y) => {
      const bi = resolveIndex();
      if (bi < 0) {
        return;
      }
      this.syncEndpointHebrewSignals(bi, endpoint);
      this.ensureYearInOptions(Number(y));
      this.normalizeHebrewSelection(bi, endpoint);
      this.syncHebrewEndpointToIso(bi, endpoint, true);
    });

    monthCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const bi = resolveIndex();
      if (bi < 0) {
        return;
      }
      this.syncEndpointHebrewSignals(bi, endpoint);
      this.normalizeHebrewSelection(bi, endpoint);
      this.syncHebrewEndpointToIso(bi, endpoint, true);
    });

    dayCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      const bi = resolveIndex();
      if (bi < 0) {
        return;
      }
      this.syncEndpointHebrewSignals(bi, endpoint);
      this.normalizeHebrewSelection(bi, endpoint);
      this.syncHebrewEndpointToIso(bi, endpoint, true);
    });
  }

  private syncEndpointHebrewSignals(bookingIndex: number, endpoint: 'start' | 'end'): void {
    const booking = this.bookingGroup(bookingIndex);
    const year = Number(booking.controls[`${endpoint}HebrewYear`].value);
    const month = Number(booking.controls[`${endpoint}HebrewMonth`].value);
    const day = Number(booking.controls[`${endpoint}HebrewDay`].value);
    if (endpoint === 'start') {
      this.patchBookingUi(bookingIndex, {
        startHebrewYear: year,
        startHebrewMonth: month,
        startHebrewDay: day
      });
    } else {
      this.patchBookingUi(bookingIndex, {
        endHebrewYear: year,
        endHebrewMonth: month,
        endHebrewDay: day
      });
    }
  }

  private normalizeHebrewSelection(bookingIndex: number, endpoint: 'start' | 'end'): void {
    const booking = this.bookingGroup(bookingIndex);
    const yearCtrl = booking.controls[`${endpoint}HebrewYear`];
    const monthCtrl = booking.controls[`${endpoint}HebrewMonth`];
    const dayCtrl = booking.controls[`${endpoint}HebrewDay`];

    let year = Number(yearCtrl.value);
    let month = Number(monthCtrl.value);
    let day = Number(dayCtrl.value);

    if (!year || !month || !day) {
      return;
    }

    if (!this.hebrew.isLeapYear(year) && month === 13) {
      month = 12;
      monthCtrl.setValue(month, { emitEvent: false });
      this.syncEndpointHebrewSignals(bookingIndex, endpoint);
    }

    const allowPast = this.editingId() !== null;
    if (!allowPast) {
      const ys = this.yearOptionsForEndpoint(bookingIndex, endpoint);
      if (ys.length > 0 && !ys.includes(year)) {
        const y2 = ys.find((yy) => yy >= year) ?? ys[ys.length - 1]!;
        yearCtrl.setValue(y2, { emitEvent: false });
        year = y2;
        this.syncEndpointHebrewSignals(bookingIndex, endpoint);
      }

      const monthOpts = this.monthOptionsForEndpoint(bookingIndex, endpoint);
      if (monthOpts.length > 0 && !monthOpts.some((m) => m.value === month)) {
        const m2 = monthOpts[0]!.value;
        monthCtrl.setValue(m2, { emitEvent: false });
        month = m2;
        this.syncEndpointHebrewSignals(bookingIndex, endpoint);
      }

      if (this.allowedHebrewDaysInMonth(year, month, false).length === 0) {
        this.patchHebrewToToday(bookingIndex, endpoint);
        return;
      }
    }

    year = Number(yearCtrl.value);
    month = Number(monthCtrl.value);
    day = Number(dayCtrl.value);

    const maxDay = this.hebrew.daysInMonth(month, year);
    if (day > maxDay) {
      dayCtrl.setValue(maxDay, { emitEvent: false });
    }

    if (!allowPast) {
      const y = Number(yearCtrl.value);
      const mo = Number(monthCtrl.value);
      const d = Number(dayCtrl.value);
      const allowed = this.allowedHebrewDaysInMonth(y, mo, false);
      if (allowed.length > 0 && !allowed.includes(d)) {
        const nextUp = allowed.find((x) => x >= d) ?? allowed[allowed.length - 1]!;
        dayCtrl.setValue(nextUp, { emitEvent: false });
      }
    }

    this.syncEndpointHebrewSignals(bookingIndex, endpoint);
  }

  /**
   * Hebrew calendar days 1..max for the month. When `allowPast` is false (new order),
   * only days whose Gregorian mapping is today or later (local midnight) are returned
   * — no fallback to past days.
   */
  private allowedHebrewDaysInMonth(year: number, month: number, allowPast: boolean): number[] {
    const max = this.hebrew.daysInMonth(month, year);
    const days = Array.from({ length: max }, (_, i) => i + 1);
    if (allowPast) {
      return days;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return days.filter((d) => {
      const g = this.hebrew.toGregorian(year, month, d);
      g.setHours(0, 0, 0, 0);
      if (allowPast) {
        return true;
      }
      if (g.getTime() < today.getTime()) {
        return false;
      }
      if (this.editingId() === null) {
        const iso = this.toIso(g);
        if (findBlockedDateForIso(iso, this.blockedDatesSig()) !== null) {
          return false;
        }
      }
      return true;
    });
  }

  /** True if this Hebrew year has at least one month with a selectable today-or-future day (create mode). */
  private hebrewYearHasSelectableFutureDay(year: number): boolean {
    for (const m of this.hebrew.monthsForYear(year)) {
      if (this.allowedHebrewDaysInMonth(year, m.value, false).length > 0) {
        return true;
      }
    }
    return false;
  }

  private patchHebrewToToday(bookingIndex: number, endpoint: 'start' | 'end'): void {
    const parts = this.hebrew.toHebrewParts(new Date());
    this.ensureYearInOptions(parts.year);
    this.bookingGroup(bookingIndex).patchValue(
      {
        [`${endpoint}HebrewYear`]: parts.year,
        [`${endpoint}HebrewMonth`]: parts.month,
        [`${endpoint}HebrewDay`]: parts.day
      },
      { emitEvent: false }
    );
    this.syncEndpointHebrewSignals(bookingIndex, endpoint);
    this.syncHebrewEndpointToIso(bookingIndex, endpoint, false);
  }

  private syncHebrewEndpointToIso(
    bookingIndex: number,
    endpoint: 'start' | 'end',
    emitDateChange: boolean
  ): void {
    const booking = this.bookingGroup(bookingIndex);
    const year = Number(booking.controls[`${endpoint}HebrewYear`].value);
    const month = Number(booking.controls[`${endpoint}HebrewMonth`].value);
    const day = Number(booking.controls[`${endpoint}HebrewDay`].value);

    const isoControlName = endpoint === 'start' ? 'startDate' : 'endDate';
    const shiftControlName = endpoint === 'start' ? 'startShift' : 'endShift';

    if (!year || !month || !day) {
      return;
    }

    const greg = this.hebrew.toGregorian(year, month, day);
    const iso = this.toIso(greg);
    booking.controls[isoControlName].setValue(iso, { emitEvent: emitDateChange });
    this.constrainShiftForDate(bookingIndex, iso, shiftControlName, false);
    if (endpoint === 'start') {
      booking.controls['orderDate'].setValue(iso, { emitEvent: false });
    }
    booking.updateValueAndValidity({ emitEvent: false });
  }

  private constrainShiftForDate(
    bookingIndex: number,
    iso: string,
    shiftControlName: 'startShift' | 'endShift',
    emitEvent = false
  ): void {
    const d = this.hebrew.parseIso(iso);
    if (!d) {
      return;
    }
    const slotCtrl = this.bookingGroup(bookingIndex).controls[shiftControlName];
    const current = slotCtrl.value as TimeSlot;
    const dow = d.getDay();
    if (dow === 5 && current !== TimeSlot.Morning) {
      slotCtrl.setValue(TimeSlot.Morning, { emitEvent });
    } else if (dow === 6 && current !== TimeSlot.Evening) {
      slotCtrl.setValue(TimeSlot.Evening, { emitEvent });
    }
  }

  private setHebrewFromIso(
    bookingIndex: number,
    iso: string,
    endpoint: 'start' | 'end',
    emitDateChange = false
  ): void {
    const parts = this.hebrew.isoToHebrewParts(iso);
    if (!parts) {
      return;
    }

    this.ensureYearInOptions(parts.year);
    this.bookingGroup(bookingIndex).patchValue(
      {
        [`${endpoint}HebrewYear`]: parts.year,
        [`${endpoint}HebrewMonth`]: parts.month,
        [`${endpoint}HebrewDay`]: parts.day
      },
      { emitEvent: false }
    );

    this.syncEndpointHebrewSignals(bookingIndex, endpoint);
    this.syncHebrewEndpointToIso(bookingIndex, endpoint, emitDateChange);
    if (endpoint === 'end') {
      this.coerceEndShiftToValidRange(bookingIndex, emitDateChange);
    }
  }

  private yearOptionsForEndpoint(bookingIndex: number, endpoint: 'start' | 'end'): number[] {
    const currentYear = this.hebrew.toHebrewParts(new Date()).year;
    const base = new Set<number>();
    for (let y = currentYear - 2; y <= currentYear + 5; y++) {
      base.add(y);
    }
    for (const y of this.extraYearsSig()) {
      base.add(y);
    }
    let years = [...base].sort((a, b) => a - b);
    if (this.editingId() === null) {
      const filtered = years.filter((y) => this.hebrewYearHasSelectableFutureDay(y));
      if (filtered.length > 0) {
        years = filtered;
      }
    }
    return years;
  }

  private monthOptionsForEndpoint(bookingIndex: number, endpoint: 'start' | 'end'): HebrewMonthOption[] {
    const ui = this.bookingUi()[bookingIndex];
    const year = endpoint === 'start' ? (ui?.startHebrewYear ?? 0) : (ui?.endHebrewYear ?? 0);
    if (!year) {
      return [];
    }
    const all = this.hebrew.monthsForYear(year);
    if (this.editingId() !== null) {
      return all;
    }
    return all.filter((m) => this.allowedHebrewDaysInMonth(year, m.value, false).length > 0);
  }

  private dayOptionsForEndpoint(bookingIndex: number, endpoint: 'start' | 'end'): number[] {
    const ui = this.bookingUi()[bookingIndex];
    const year = endpoint === 'start' ? (ui?.startHebrewYear ?? 0) : (ui?.endHebrewYear ?? 0);
    const month = endpoint === 'start' ? (ui?.startHebrewMonth ?? 0) : (ui?.endHebrewMonth ?? 0);
    if (!year || !month) {
      return [];
    }
    const allowPast = this.editingId() !== null;
    return this.allowedHebrewDaysInMonth(year, month, allowPast);
  }

  /** Ensures the given year is selectable in the year dropdown. */
  private ensureYearInOptions(year: number): void {
    if (!year) {
      return;
    }
    this.extraYearsSig.update((arr) => (arr.includes(year) ? arr : [...arr, year]));
  }

  private buildDynamicEquipmentRow(init: {
    inventoryDefinitionId: number | null;
    loanedEquipmentType: LoanedEquipmentType | null;
    label: string;
    quantity: number;
    selectedCodes: string[];
    initialCodes?: string[];
    lineId: number | null;
    isCustomItem: boolean;
  }): FormGroup {
    return this.fb.group({
      inventoryDefinitionId: this.fb.control<number | null>(init.inventoryDefinitionId),
      loanedEquipmentType: this.fb.control<LoanedEquipmentType | null>(init.loanedEquipmentType),
      label: this.fb.nonNullable.control(init.label),
      quantity: this.fb.nonNullable.control(Math.max(1, init.quantity), [
        Validators.required,
        Validators.min(1)
      ]),
      selectedCodes: this.fb.nonNullable.control<string[]>([...init.selectedCodes]),
      initialCodes: this.fb.nonNullable.control<string[]>([...(init.initialCodes ?? init.selectedCodes)]),
      lineId: this.fb.control<number | null>(init.lineId),
      isCustomItem: this.fb.nonNullable.control(init.isCustomItem)
    });
  }

  // -----------------------------------------------------------------
  // Load (edit mode)
  // -----------------------------------------------------------------

  /** Rebuild the reactive form from a minimized draft snapshot. */
  private applySoundOrderDraft(draft: SoundOrderDraftPayload): void {
    this.editingId.set(draft.editingId);
    this.orderCancelled.set(draft.orderCancelled);
    this.phone1DigitsSig.set(draft.phone1Digits ?? '');
    this.existingCustomerMatch.set(null);
    this.customerSuggestions.set([]);
    this.customerSuggestOpen.set(false);
    this.addAccessoryOpen.set(false);
    this.accessoryTypeQuery.set('');
    this.accessorySerialDropdownRow.set(null);

    if (draft.boardDate) {
      this.calendarView.setSelectedDate(draft.boardDate);
    }

    const raw = draft.formValue ?? {};
    const bookingsRaw = Array.isArray(raw['bookings']) ? (raw['bookings'] as Record<string, unknown>[]) : [];
    const equipmentRaw = Array.isArray(raw['loanedEquipments'])
      ? (raw['loanedEquipments'] as Record<string, unknown>[])
      : [];

    while (this.bookings.length > 0) {
      this.bookings.removeAt(0);
    }
    this.bookingUi.set([]);

    const sources = bookingsRaw.length > 0 ? bookingsRaw : [{}];
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i] ?? {};
      const group = this.buildBookingGroup();
      this.bookings.push(group);
      this.ensureBookingUi(i);

      const uiSnap = draft.bookingUi[i];
      if (uiSnap) {
        this.patchBookingUi(i, {
          occupiedById: { ...(uiSnap.occupiedById ?? {}) },
          slotTaken: !!uiSnap.slotTaken,
          equipmentDropdownOpen: false,
          startHebrewYear: Number(uiSnap.startHebrewYear) || 0,
          startHebrewMonth: Number(uiSnap.startHebrewMonth) || 0,
          startHebrewDay: Number(uiSnap.startHebrewDay) || 0,
          endHebrewYear: Number(uiSnap.endHebrewYear) || 0,
          endHebrewMonth: Number(uiSnap.endHebrewMonth) || 0,
          endHebrewDay: Number(uiSnap.endHebrewDay) || 0
        });
      }

      this.runWithoutRangeSync(() => {
        group.patchValue(
          {
            equipmentDefinitionIds: Array.isArray(src['equipmentDefinitionIds'])
              ? (src['equipmentDefinitionIds'] as string[])
              : [],
            startDate: typeof src['startDate'] === 'string' ? src['startDate'] : group.controls['startDate'].value,
            startShift: (src['startShift'] as TimeSlot) ?? group.controls['startShift'].value,
            endDate: typeof src['endDate'] === 'string' ? src['endDate'] : group.controls['endDate'].value,
            endShift: (src['endShift'] as TimeSlot) ?? group.controls['endShift'].value,
            orderDate: typeof src['orderDate'] === 'string' ? src['orderDate'] : group.controls['orderDate'].value,
            startHebrewYear:
              typeof src['startHebrewYear'] === 'number'
                ? src['startHebrewYear']
                : group.controls['startHebrewYear'].value,
            startHebrewMonth:
              typeof src['startHebrewMonth'] === 'number'
                ? src['startHebrewMonth']
                : group.controls['startHebrewMonth'].value,
            startHebrewDay:
              typeof src['startHebrewDay'] === 'number'
                ? src['startHebrewDay']
                : group.controls['startHebrewDay'].value,
            endHebrewYear:
              typeof src['endHebrewYear'] === 'number'
                ? src['endHebrewYear']
                : group.controls['endHebrewYear'].value,
            endHebrewMonth:
              typeof src['endHebrewMonth'] === 'number'
                ? src['endHebrewMonth']
                : group.controls['endHebrewMonth'].value,
            endHebrewDay:
              typeof src['endHebrewDay'] === 'number'
                ? src['endHebrewDay']
                : group.controls['endHebrewDay'].value,
            returnTimeType: (src['returnTimeType'] as ReturnTimeType) ?? ReturnTimeType.LateNight,
            customReturnTime: typeof src['customReturnTime'] === 'string' ? src['customReturnTime'] : ''
          },
          { emitEvent: false }
        );
      });

      this.wireBookingGroup(i);
      this.syncEndpointHebrewSignals(i, 'start');
      this.syncEndpointHebrewSignals(i, 'end');
      this.syncShiftsFromRange(i);
    }

    this.form.patchValue(
      {
        customerName: typeof raw['customerName'] === 'string' ? raw['customerName'] : '',
        phone: typeof raw['phone'] === 'string' ? raw['phone'] : '',
        phone2: typeof raw['phone2'] === 'string' ? raw['phone2'] : '',
        address: typeof raw['address'] === 'string' ? raw['address'] : '',
        institutionName: typeof raw['institutionName'] === 'string' ? raw['institutionName'] : '',
        institutionId: typeof raw['institutionId'] === 'number' ? raw['institutionId'] : null,
        depositType: (raw['depositType'] as DepositType | null) ?? null,
        depositOnName: typeof raw['depositOnName'] === 'string' ? raw['depositOnName'] : '',
        paymentAmount: typeof raw['paymentAmount'] === 'number' ? raw['paymentAmount'] : null,
        isUnpaid: raw['isUnpaid'] === true,
        notes: typeof raw['notes'] === 'string' ? raw['notes'] : ''
      },
      { emitEvent: false }
    );

    while (this.equipmentList.length > 0) {
      this.equipmentList.removeAt(0);
    }
    for (const row of equipmentRaw) {
      this.equipmentList.push(
        this.buildDynamicEquipmentRow({
          inventoryDefinitionId:
            typeof row['inventoryDefinitionId'] === 'number' ? row['inventoryDefinitionId'] : null,
          loanedEquipmentType: (row['loanedEquipmentType'] as LoanedEquipmentType | null) ?? null,
          label: typeof row['label'] === 'string' ? row['label'] : '',
          quantity: typeof row['quantity'] === 'number' ? row['quantity'] : 1,
          selectedCodes: Array.isArray(row['selectedCodes'])
            ? (row['selectedCodes'] as string[]).filter((c) => typeof c === 'string')
            : [],
          lineId: typeof row['lineId'] === 'number' ? row['lineId'] : null,
          isCustomItem: row['isCustomItem'] === true
        })
      );
    }

    this.form.markAsDirty();
    this.form.updateValueAndValidity({ emitEvent: false });
    for (let i = 0; i < this.bookings.length; i++) {
      this.bookingGroup(i).updateValueAndValidity({ emitEvent: false });
      this.refreshSlotTakenWarning(i);
    }
    this.refreshAccessorySerialAvailability();
    this.refreshLostEquipmentAlert();
    this.institutionConflictTrigger$.next();
    queueMicrotask(() => this.resetScrollForOrderForm());

    // Soft-load server order metadata for return UI without overwriting the draft form.
    if (draft.editingId !== null) {
      this.data.getOrderById(draft.editingId).subscribe((order) => {
        if (order) {
          this.loadedOrder.set(order);
          this.syncReturnedSerialState(order);
        }
      });
    }
  }

  private loadOrder(id: number): void {
    this.inventoryStore
      .load()
      .pipe(switchMap(() => this.data.getOrderById(id)))
      .subscribe({
        next: (order) => {
          if (order === null) {
            this.navigateAfterOrderFlow();
            return;
          }
          this.orderCancelled.set(!!order.isCancelled);
          this.loadedOrder.set(order);
          this.populateFormFromOrder(order, 'edit');
          queueMicrotask(() => this.resetScrollForOrderForm());
        }
      });
  }

  /** Pre-fills a new order from an existing booking; dates are reset to today. */
  private loadOrderForRenewal(id: number): void {
    this.inventoryStore
      .load()
      .pipe(switchMap(() => this.data.getOrderById(id)))
      .subscribe({
        next: (order) => {
          if (order === null) {
            this.toast.error('לא נמצאה ההזמנה לחידוש');
            this.navigateAfterOrderFlow();
            return;
          }
          this.orderCancelled.set(false);
          this.existingCustomerMatch.set(null);
          this.populateFormFromOrder(order, 'renew');
          this.toast.show('הטופס מולא מהזמנה קודמת — התאריך עודכן להיום', 'info');
          queueMicrotask(() => this.resetScrollForOrderForm());
        }
      });
  }

  private populateFormFromOrder(order: OrderDto, mode: 'edit' | 'renew'): void {
    if (mode === 'edit') {
      this.existingCustomerMatch.set(null);
    }

    while (this.bookings.length > 1) {
      this.bookings.removeAt(this.bookings.length - 1);
    }
    this.bookingUi.set([]);
    this.ensureBookingUi(0);

    const bookingIndex = 0;
    const booking = this.bookingGroup(bookingIndex);

    const equipmentDefinitionIds = (order.equipmentDefinitionIds ?? [])
      .filter((id) => this.equipmentSlots.hasSpeakerSlot(id));
    const shifts = [...(order.shifts ?? [])]
      .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || this.shiftOrder(a.timeSlot) - this.shiftOrder(b.timeSlot));
    const firstShift = shifts[0];
    const lastShift = shifts[shifts.length - 1];

    let startIso: string;
    let endIso: string;
    let startShift: TimeSlot;
    let endShift: TimeSlot;

    if (mode === 'renew') {
      const todayIso = this.toIso(new Date());
      startIso = todayIso;
      endIso = todayIso;
      const allowedToday = this.availableTimeSlots(todayIso);
      const originalStart = firstShift?.timeSlot ?? TimeSlot.Morning;
      const originalEnd = lastShift?.timeSlot ?? originalStart;
      startShift = allowedToday.includes(originalStart)
        ? originalStart
        : (allowedToday[0] ?? TimeSlot.Morning);
      endShift = allowedToday.includes(originalEnd)
        ? originalEnd
        : (allowedToday[allowedToday.length - 1] ?? startShift);
      if (this.compareShiftEndpoints(startIso, startShift, endIso, endShift) < 0) {
        endShift = startShift;
      }
    } else {
      startIso = firstShift?.orderDate ?? (booking.controls['startDate'].value as string);
      endIso = lastShift?.orderDate ?? firstShift?.orderDate ?? (booking.controls['endDate'].value as string);
      startShift = firstShift?.timeSlot ?? TimeSlot.Morning;
      endShift = lastShift?.timeSlot ?? firstShift?.timeSlot ?? TimeSlot.Morning;
    }

    this.runWithoutRangeSync(() => {
      booking.patchValue(
        {
          equipmentDefinitionIds,
          startDate: startIso,
          startShift,
          endDate: endIso,
          endShift,
          returnTimeType: order.returnTimeType ?? ReturnTimeType.LateNight,
          customReturnTime: order.customReturnTime ?? ''
        },
        { emitEvent: false }
      );

      this.form.patchValue(
        {
          customerName: order.customerName ?? '',
          phone: order.phone,
          phone2: order.phone2 ?? '',
          address: order.address ?? '',
          institutionName: order.institutionName ?? '',
          institutionId: order.institutionId ?? null,
          depositType: order.depositType ?? null,
          depositOnName: order.depositOnName ?? '',
          paymentAmount: order.paymentAmount ?? null,
          isUnpaid: mode === 'renew' ? true : order.isUnpaid,
          notes: order.notes ?? ''
        },
        { emitEvent: false }
      );

      if (mode === 'renew') {
        this.phone1DigitsSig.set(OrderFormComponent.digitsOnly(String(order.phone ?? '')));
        this.existingCustomerMatch.set(null);
      }

      this.setHebrewFromIso(bookingIndex, startIso, 'start', false);
      this.setHebrewFromIso(bookingIndex, endIso, 'end', false);
    });

    this.syncShiftsFromRange(bookingIndex);

    this.syncReturnedSerialState(order);

    while (this.equipmentList.length > 0) {
      this.equipmentList.removeAt(0);
    }
    this.addAccessoryOpen.set(false);
    this.accessoryTypeQuery.set('');
    this.accessorySerialDropdownRow.set(null);

    const catalog = this.inventoryStore.definitions();
    for (const row of order.loanedEquipments ?? []) {
      if (row.quantity <= 0) {
        continue;
      }
      const codes = (row.notes ?? [])
        .slice()
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((n) => (n.content ?? '').trim())
        .filter((c) => c.length > 0);

      if (row.isCustomItem) {
        const name = (row.customItemName ?? '').trim();
        const def =
          catalog.find(
            (d) =>
              !d.linkedEquipmentType &&
              d.displayName.localeCompare(name, 'he', { sensitivity: 'accent' }) === 0
          ) ?? null;
        this.equipmentList.push(
          this.buildDynamicEquipmentRow({
            inventoryDefinitionId: def?.id ?? null,
            loanedEquipmentType: null,
            label: def?.displayName ?? (name || 'פריט נוסף'),
            quantity: Math.max(row.quantity, codes.length, 1),
            selectedCodes: codes,
            lineId: row.id ?? null,
            isCustomItem: true
          })
        );
        continue;
      }

      if (row.loanedEquipmentType == null) {
        continue;
      }
      const type = row.loanedEquipmentType;
      const def = catalog.find((d) => d.linkedEquipmentType === type) ?? null;
      this.equipmentList.push(
        this.buildDynamicEquipmentRow({
          inventoryDefinitionId: def?.id ?? null,
          loanedEquipmentType: type,
          label: def?.displayName ?? this.inventoryStore.displayLabelForType(type),
          quantity: Math.max(row.quantity, codes.length, 1),
          selectedCodes: codes,
          lineId: row.id ?? null,
          isCustomItem: false
        })
      );
    }

    this.refreshAccessorySerialAvailability();
    this.refreshLostEquipmentAlert();
    this.institutionConflictTrigger$.next();
  }

  // -----------------------------------------------------------------
  // Submit payload
  // -----------------------------------------------------------------

  /** One independent order payload per booking section (separate DB rows on create). */
  private toPayloads(): OrderCreateUpdateDto[] {
    const shared = this.sharedCustomerPaymentFields();
    const loaned = this.toLoanedEquipmentsPayload();
    const count = this.isEdit() ? 1 : this.bookings.length;
    const payloads: OrderCreateUpdateDto[] = [];

    for (let i = 0; i < count; i++) {
      const booking = this.bookingGroup(i).getRawValue() as Record<string, unknown>;
      payloads.push({
        equipmentDefinitionIds: this.equipmentIdsControl(i).value,
        shifts: this.shiftsArray(i).getRawValue() as OrderShiftDto[],
        ...shared,
        returnTimeType: (booking['returnTimeType'] as ReturnTimeType | null) ?? ReturnTimeType.LateNight,
        customReturnTime: (booking['returnTimeType'] as ReturnTimeType | null) === ReturnTimeType.SpecificTime
          ? this.optionalText(booking['customReturnTime'])
          : null,
        loanedEquipments: loaned,
        allowDoubleBooking: false
      });
    }

    return payloads;
  }

  private sharedCustomerPaymentFields(): Pick<
    OrderCreateUpdateDto,
    | 'customerName'
    | 'phone'
    | 'phone2'
    | 'address'
    | 'institutionName'
    | 'institutionId'
    | 'depositType'
    | 'depositOnName'
    | 'paymentAmount'
    | 'isUnpaid'
    | 'notes'
  > {
    const v = this.form.getRawValue() as Record<string, unknown>;
    return {
      customerName: this.optionalText(v['customerName']),
      phone: (v['phone'] as string).trim(),
      phone2: this.optionalText(v['phone2']),
      address: this.optionalText(v['address']),
      institutionName: this.optionalText(v['institutionName']),
      institutionId: (v['institutionId'] as number | null) ?? null,
      depositType: (v['depositType'] as DepositType | null) ?? null,
      depositOnName: this.optionalText(v['depositOnName']),
      paymentAmount: v['paymentAmount'] === '' || v['paymentAmount'] == null
        ? null
        : Math.max(0, Math.trunc(Number(v['paymentAmount']))),
      isUnpaid: !!v['isUnpaid'],
      notes: this.optionalText(v['notes'])
    };
  }

  private toLoanedEquipmentsPayload(): OrderLoanedEquipmentDto[] {
    const v = this.form.getRawValue() as Record<string, unknown>;
    const rows = (v['loanedEquipments'] as Record<string, unknown>[]) ?? [];
    const result: OrderLoanedEquipmentDto[] = [];

    for (const row of rows) {
      const selectedCodes = Array.isArray(row['selectedCodes'])
        ? (row['selectedCodes'] as string[]).map((c) => String(c).trim()).filter((c) => c.length > 0)
        : [];
      const quantityRaw = Number(row['quantity']);
      const quantity =
        selectedCodes.length > 0
          ? selectedCodes.length
          : Number.isFinite(quantityRaw) && quantityRaw > 0
            ? Math.trunc(quantityRaw)
            : 0;
      if (quantity <= 0) {
        continue;
      }

      const isCustomItem = !!row['isCustomItem'] || row['loanedEquipmentType'] == null;
      const lineId = row['lineId'];
      const label = String(row['label'] ?? '').trim();

      if (isCustomItem) {
        result.push({
          ...(typeof lineId === 'number' && lineId > 0 ? { id: lineId } : {}),
          isCustomItem: true,
          customItemName: label || 'פריט נוסף',
          loanedEquipmentType: null,
          quantity,
          expectedNoteCount: quantity,
          notes: selectedCodes.map((code, ordinal) => ({
            ordinal,
            content: code,
            isReturned: false
          }))
        });
        continue;
      }

      const type = row['loanedEquipmentType'] as LoanedEquipmentType;
      result.push({
        ...(typeof lineId === 'number' && lineId > 0 ? { id: lineId } : {}),
        isCustomItem: false,
        loanedEquipmentType: type,
        quantity,
        expectedNoteCount: quantity,
        notes: selectedCodes.map((code, ordinal) => ({
          ordinal,
          content: code,
          ...(this.isReturnedSerialCode(type, code) ? { isReturned: true } : {})
        }))
      });
    }

    return result;
  }

  private syncReturnedSerialState(order: OrderDto): void {
    const returnedMap = new Map<LoanedEquipmentType, Set<string>>();
    const lineIds = new Map<LoanedEquipmentType, number>();

    for (const row of order.loanedEquipments ?? []) {
      if (row.isCustomItem || row.loanedEquipmentType == null) {
        continue;
      }

      const type = row.loanedEquipmentType;
      if (row.id) {
        lineIds.set(type, row.id);
      }

      const returned = new Set<string>();
      for (const note of row.notes ?? []) {
        const content = (note.content ?? '').trim();
        if (note.isReturned && content.length > 0) {
          returned.add(content);
        }
      }
      if (returned.size > 0) {
        returnedMap.set(type, returned);
      }
    }

    this.returnedSerialCodesByType.set(returnedMap);
    this.loanedLineIdsByType.set(lineIds);
  }

  /** Trims a form value and returns `null` for blanks so the server stores NULL. */
  private optionalText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toIso(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
