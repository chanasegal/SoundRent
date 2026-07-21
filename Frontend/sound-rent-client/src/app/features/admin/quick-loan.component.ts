import { CommonModule, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, finalize, merge, EMPTY } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, startWith, switchMap } from 'rxjs/operators';

import { AccessorySerialOptionDto } from '../../core/models/accessory-inventory.model';
import { CustomerSuggestDto } from '../../core/models/customer.model';
import { InventoryDefinitionDto } from '../../core/models/inventory-definition.model';
import {
  LOANED_EQUIPMENT_LABELS,
  LOANED_EQUIPMENT_ORDER,
  LoanedEquipmentType,
  ReturnTimeType,
  TIME_SLOT_LABELS,
  TimeSlot
} from '../../core/models/enums';
import { OrderCreateUpdateDto, OrderDto, OrderLoanedEquipmentDto, OrderShiftDto } from '../../core/models/order.model';
import { OrderReturnRequestDto } from '../../core/models/equipment-return.model';
import { CustomersStore } from '../../core/services/customers.store';
import { DataService } from '../../core/services/data.service';
import { HebrewDateParts, HebrewDateService } from '../../core/services/hebrew-date.service';
import { InventoryDefinitionsStore } from '../../core/services/inventory-definitions.store';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import { OrdersSyncService } from '../../core/services/orders-sync.service';
import { ToastService } from '../../core/services/toast.service';
import {
  ISRAELI_PHONE_INVALID_MESSAGE,
  israeliPhoneValidator
} from '../../core/validators/israeli-phone.validator';
import { IntegerOnlyDirective } from '../../shared/directives/integer-only.directive';
import { IsraeliPhoneInputDirective } from '../../shared/directives/israeli-phone-input.directive';
import { HebrewCalendarPickerComponent } from '../../shared/hebrew-calendar-picker/hebrew-calendar-picker.component';

interface QuickLoanAccessoryRow {
  /** Catalog row id from InventoryDefinitions (shared store). */
  inventoryDefinitionId: number;
  /** Set when the catalog row is linked to a system LoanedEquipmentType. */
  type: LoanedEquipmentType | null;
  label: string;
  quantity: number;
  selectedCodes: string[];
  lineId?: number;
}

interface ReturnModalRow {
  rowId: string;
  loanedEquipmentId: number;
  label: string;
  quantityLoaned: number;
  quantityReturned: number;
  isCustomItem: boolean;
  assignedSerialCodes: string[];
  returnedSerialCodes: string[];
}

interface ActiveLoanRow {
  key: string;
  orderId: number;
  loanedEquipmentId: number;
  customerName: string;
  phone: string;
  address: string;
  accessoryName: string;
  quantity: number;
  codes: string[];
  loanDateIso: string;
  isCustomItem: boolean;
  assignedSerialCodes: string[];
  /** True when the loan comes from a full order (grid equipment), not a standalone quick loan. */
  isOrderBased: boolean;
}

interface QuickReturnItem {
  key: string;
  orderId: number;
  loanedEquipmentId: number;
  accessoryName: string;
  /** Specific serial being offered for return; null for quantity-only lines. */
  serialCode: string | null;
  quantity: number;
  selected: boolean;
  isScannedMatch: boolean;
}

interface QuickReturnSession {
  scannedCode: string;
  customerName: string;
  phone: string;
  address: string;
  items: QuickReturnItem[];
}

@Component({
  selector: 'app-quick-loan',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    RouterLink,
    HebrewCalendarPickerComponent,
    IntegerOnlyDirective,
    IsraeliPhoneInputDirective
  ],
  templateUrl: './quick-loan.component.html',
  styleUrl: './quick-loan.component.scss'
})
export class QuickLoanComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly ordersSync = inject(OrdersSyncService);
  private readonly toast = inject(ToastService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly customers = inject(CustomersStore);
  private readonly inventoryStore = inject(InventoryDefinitionsStore);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  protected readonly pageTitle = inject(WorkspaceUiService).title('השאלת אביזרים');

  private readonly initialHebrew = this.hebrew.toHebrewParts(new Date());
  private readonly extraYearsSig = signal<number[]>([]);
  private static readonly CUSTOMER_SUGGEST_LIMIT = 8;
  private readonly defaultTimeSlot = TimeSlot.Morning;

  protected readonly hebrewYearSig = signal(this.initialHebrew.year);
  protected readonly hebrewMonthSig = signal(this.initialHebrew.month);
  protected readonly hebrewDaySig = signal(this.initialHebrew.day);

  protected readonly israeliPhoneInvalidMessage = ISRAELI_PHONE_INVALID_MESSAGE;

  protected readonly accessoryRows = signal<QuickLoanAccessoryRow[]>([]);
  protected readonly addAccessoryOpen = signal(false);
  protected readonly accessoryTypeQuery = signal('');
  private nextOneTimeAccessoryId = -1;

  private readonly availabilityByType = signal<Map<LoanedEquipmentType, AccessorySerialOptionDto[]>>(
    new Map()
  );
  private readonly availabilityLoading = signal(false);
  protected readonly openSerialDropdownId = signal<number | null>(null);
  protected readonly serialQuickEntry = signal('');
  protected readonly submitting = signal(false);
  protected readonly editingId = signal<number | null>(null);
  protected readonly activeLoans = signal<OrderDto[]>([]);
  protected readonly activeLoading = signal(false);
  protected readonly returningLineKey = signal<string | null>(null);
  protected readonly removingLineKeys = signal<Set<string>>(new Set());
  protected readonly deletingId = signal<number | null>(null);
  protected readonly deleteConfirmOrder = signal<OrderDto | null>(null);

  protected readonly returnModalOpen = signal(false);
  protected readonly returnSaving = signal(false);
  protected readonly returnOrderId = signal<number | null>(null);
  protected readonly returnRows = signal<ReturnModalRow[]>([]);
  protected readonly returnSerialDropdownRowId = signal<string | null>(null);

  protected readonly quickReturnTypeId = signal<number | null>(null);
  protected readonly quickReturnCode = signal('');
  protected readonly quickReturnCodeOpen = signal(false);
  protected readonly quickReturnSearching = signal(false);
  protected readonly quickReturnSaving = signal(false);
  protected readonly quickReturnSession = signal<QuickReturnSession | null>(null);

  protected readonly customerSuggestions = signal<CustomerSuggestDto[]>([]);
  protected readonly customerSuggestOpen = signal(false);
  protected readonly customerSuggestField = signal<'name' | 'phone' | null>(null);
  protected readonly customerSuggestIndex = signal(-1);

  protected readonly form = this.fb.group({
    customerName: ['', [Validators.maxLength(100)]],
    phone: ['', [Validators.required, Validators.maxLength(10), israeliPhoneValidator()]],
    address: ['', [Validators.maxLength(200)]],
    hebrewYear: [this.initialHebrew.year, Validators.required],
    hebrewMonth: [this.initialHebrew.month, Validators.required],
    hebrewDay: [this.initialHebrew.day, Validators.required],
    notes: ['', Validators.maxLength(1000)]
  });

  protected readonly yearOptions = signal(this.buildYearOptions());
  protected readonly monthOptions = signal(this.hebrew.monthsForYear(this.initialHebrew.year));
  protected readonly dayOptions = signal(
    Array.from({ length: this.hebrew.daysInMonth(this.initialHebrew.month, this.initialHebrew.year) }, (_, i) => i + 1)
  );

  protected readonly activeLoanRows = computed(() => this.buildActiveLoanRows(this.activeLoans()));

  protected readonly quickReturnTypes = computed(() => this.inventoryStore.definitions());

  protected readonly quickReturnSelectedType = computed(() => {
    const id = this.quickReturnTypeId();
    return id != null ? this.inventoryStore.byId(id) ?? null : null;
  });

  protected readonly quickReturnCodeOptions = computed(() => {
    const def = this.quickReturnSelectedType();
    if (!def) {
      return [] as string[];
    }

    const codes = new Set<string>();
    for (const row of this.activeLoanRows()) {
      if (!this.rowMatchesAccessoryType(row, def)) {
        continue;
      }
      for (const code of row.assignedSerialCodes.length > 0 ? row.assignedSerialCodes : row.codes) {
        const trimmed = code.trim();
        if (trimmed) {
          codes.add(trimmed);
        }
      }
    }

    for (const unit of def.serialUnits ?? []) {
      if (unit.physicalStatus === 'LoanedOut' && unit.serialCode.trim()) {
        codes.add(unit.serialCode.trim());
      }
    }

    if (codes.size === 0) {
      for (const code of def.serialCodes ?? []) {
        const trimmed = code.trim();
        if (trimmed) {
          codes.add(trimmed);
        }
      }
    }

    const query = this.quickReturnCode().trim().toLowerCase();
    const list = [...codes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!query) {
      return list;
    }
    return list.filter((code) => code.toLowerCase().includes(query));
  });

  ngOnInit(): void {
    this.wireDateForm();
    this.wireAvailabilityRefresh();
    this.wireCustomerAutocomplete();
    this.inventoryStore.load({ force: true }).subscribe();
    this.refreshAvailability();
    this.loadActiveLoans();
  }

  protected dayLabel(day: number): string {
    return this.hebrew.dayGematriya(day);
  }

  protected yearLabel(year: number): string {
    return this.hebrew.yearGematriya(year);
  }

  protected patchHebrewFromCalendar(
    part: Partial<Pick<HebrewDateParts, 'year' | 'month' | 'day'>>
  ): void {
    const patch: Record<string, number> = {};
    if (part.year !== undefined) {
      patch['hebrewYear'] = part.year;
      this.ensureYearInOptions(part.year);
    }
    if (part.month !== undefined) {
      patch['hebrewMonth'] = part.month;
    }
    if (part.day !== undefined) {
      patch['hebrewDay'] = part.day;
    }
    if (Object.keys(patch).length > 0) {
      this.form.patchValue(patch);
    }
  }

  protected selectedIso(): string | null {
    return this.hebrewPartsToIso(
      this.hebrewYearSig(),
      this.hebrewMonthSig(),
      this.hebrewDaySig()
    );
  }

  protected selectedCodes(row: QuickLoanAccessoryRow): string[] {
    return row.selectedCodes;
  }

  protected updateRowQuantity(row: QuickLoanAccessoryRow, raw: string): void {
    const parsed = Number.parseInt(raw, 10);
    const quantity = Number.isFinite(parsed) ? Math.max(1, parsed) : 1;
    this.accessoryRows.update((rows) =>
      rows.map((r) => (r.inventoryDefinitionId === row.inventoryDefinitionId ? { ...r, quantity } : r))
    );
  }

  /** Unused catalog rows from the shared sorted inventory store. */
  protected availableAccessoryTypes(): InventoryDefinitionDto[] {
    const used = new Set(this.accessoryRows().map((r) => r.inventoryDefinitionId));
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

  protected showCustomAccessoryOption(): boolean {
    const query = this.accessoryTypeQuery().trim();
    if (query.length < 2) {
      return false;
    }
    const lower = query.toLowerCase();
    return !this.inventoryStore.definitions().some(
      (d) => d.displayName.trim().toLowerCase() === lower
    );
  }

  protected customAccessoryOptionLabel(): string {
    return `הוסף "${this.accessoryTypeQuery().trim()}" להשאלה זו בלבד`;
  }

  protected accessoryTypeLabel(def: InventoryDefinitionDto): string {
    return def.displayName;
  }

  protected toggleAddAccessory(): void {
    const willOpen = !this.addAccessoryOpen();
    this.addAccessoryOpen.set(willOpen);
    this.accessoryTypeQuery.set('');
    if (willOpen) {
      queueMicrotask(() => this.focusAccessoryTypeSearch());
    }
  }

  protected onAccessoryTypeChosen(defOrId: InventoryDefinitionDto | number | string): void {
    const id = typeof defOrId === 'object' ? defOrId.id : Number(defOrId);
    if (!Number.isFinite(id) || id <= 0) {
      return;
    }
    const def = this.inventoryStore.byId(id);
    if (!def) {
      this.toast.warning('הפריט לא נמצא במלאי');
      return;
    }
    if (this.accessoryRows().some((r) => r.inventoryDefinitionId === def.id)) {
      this.toast.warning('סוג אביזר זה כבר נוסף');
      return;
    }

    const linked = def.linkedEquipmentType as LoanedEquipmentType | null | undefined;
    const type =
      linked && LOANED_EQUIPMENT_ORDER.includes(linked) ? linked : null;

    const row: QuickLoanAccessoryRow = {
      inventoryDefinitionId: def.id,
      type,
      label: def.displayName,
      quantity: 1,
      selectedCodes: []
    };
    this.accessoryRows.update((rows) => [...rows, row]);
    this.addAccessoryOpen.set(false);
    this.accessoryTypeQuery.set('');
  }

  protected onCustomAccessoryTypeChosen(): void {
    const name = this.accessoryTypeQuery().trim();
    if (name.length < 2) {
      this.toast.warning('יש להזין לפחות שני תווים');
      return;
    }
    if (
      this.accessoryRows().some((r) => r.label.trim().toLowerCase() === name.toLowerCase())
    ) {
      this.toast.warning('סוג אביזר זה כבר נוסף');
      return;
    }

    // One-time loan-only item — do not persist into the inventory master list.
    const row: QuickLoanAccessoryRow = {
      inventoryDefinitionId: this.nextOneTimeAccessoryId--,
      type: null,
      label: name,
      quantity: 1,
      selectedCodes: []
    };
    this.accessoryRows.update((rows) => [...rows, row]);
    this.addAccessoryOpen.set(false);
    this.accessoryTypeQuery.set('');
    this.toast.success(`"${name}" נוסף להשאלה זו בלבד`);
  }

  protected onAccessorySearchKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();

    const filtered = this.filteredAccessoryTypes();
    if (filtered.length === 1) {
      this.onAccessoryTypeChosen(filtered[0]);
      return;
    }

    if (this.showCustomAccessoryOption()) {
      this.onCustomAccessoryTypeChosen();
    }
  }

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

        const byDefinition = new Map<
          number,
          { defId: number; type: LoanedEquipmentType | null; codes: string[] }
        >();
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
        this.accessoryRows.update((rows) => {
          let next = [...rows];
          for (const group of byDefinition.values()) {
            const result = this.mergeDefaultAccessoryCodesIntoRowsByDefinition(
              next,
              group.defId,
              group.type,
              group.codes
            );
            next = result.rows;
            if (result.changed) {
              addedAny = true;
            }
          }
          for (const [type, codes] of byType) {
            const result = this.mergeDefaultAccessoryCodesIntoRows(next, type, codes);
            next = result.rows;
            if (result.changed) {
              addedAny = true;
            }
          }
          return next;
        });

        if (addedAny) {
          this.toast.success(`נוסף ציוד נלווה קבוע למיקסר #${parentSerial}`);
        }
      });
  }

  private mergeDefaultAccessoryCodesIntoRowsByDefinition(
    rows: QuickLoanAccessoryRow[],
    inventoryDefinitionId: number,
    type: LoanedEquipmentType | null,
    codes: string[]
  ): { rows: QuickLoanAccessoryRow[]; changed: boolean } {
    if (codes.length === 0) {
      return { rows, changed: false };
    }

    const index = rows.findIndex((r) => r.inventoryDefinitionId === inventoryDefinitionId);
    if (index < 0) {
      const def = this.inventoryStore.byId(inventoryDefinitionId);
      if (!def) {
        return type
          ? this.mergeDefaultAccessoryCodesIntoRows(rows, type, codes)
          : { rows, changed: false };
      }
      return {
        rows: [
          ...rows,
          {
            inventoryDefinitionId: def.id,
            type,
            label: def.displayName,
            quantity: codes.length,
            selectedCodes: [...codes]
          }
        ],
        changed: true
      };
    }

    const existing = rows[index];
    const merged = [...existing.selectedCodes];
    let changed = false;
    for (const code of codes) {
      if (!merged.some((c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0)) {
        merged.push(code);
        changed = true;
      }
    }
    if (!changed) {
      return { rows, changed: false };
    }

    const next = [...rows];
    next[index] = {
      ...existing,
      selectedCodes: merged,
      quantity: Math.max(merged.length, 1)
    };
    return { rows: next, changed: true };
  }

  private mergeDefaultAccessoryCodesIntoRows(
    rows: QuickLoanAccessoryRow[],
    type: LoanedEquipmentType,
    codes: string[]
  ): { rows: QuickLoanAccessoryRow[]; changed: boolean } {
    if (codes.length === 0) {
      return { rows, changed: false };
    }

    const index = rows.findIndex((r) => r.type === type);
    if (index < 0) {
      const def = this.inventoryStore.definitions().find((d) => d.linkedEquipmentType === type);
      if (!def) {
        return { rows, changed: false };
      }
      return {
        rows: [
          ...rows,
          {
            inventoryDefinitionId: def.id,
            type,
            label: def.displayName,
            quantity: codes.length,
            selectedCodes: [...codes]
          }
        ],
        changed: true
      };
    }

    const existing = rows[index];
    const merged = [...existing.selectedCodes];
    let changed = false;
    for (const code of codes) {
      if (!merged.some((c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0)) {
        merged.push(code);
        changed = true;
      }
    }
    if (!changed) {
      return { rows, changed: false };
    }

    const next = [...rows];
    next[index] = {
      ...existing,
      selectedCodes: merged,
      quantity: Math.max(merged.length, 1)
    };
    return { rows: next, changed: true };
  }

  protected removeAccessoryRow(row: QuickLoanAccessoryRow): void {
    this.accessoryRows.update((rows) =>
      rows.filter((r) => r.inventoryDefinitionId !== row.inventoryDefinitionId)
    );
    if (this.openSerialDropdownId() === row.inventoryDefinitionId) {
      this.openSerialDropdownId.set(null);
      this.serialQuickEntry.set('');
    }
  }

  protected isSerialDropdownOpen(row: QuickLoanAccessoryRow): boolean {
    return this.openSerialDropdownId() === row.inventoryDefinitionId;
  }

  protected serialOptionsForRow(row: QuickLoanAccessoryRow): AccessorySerialOptionDto[] {
    if (row.type) {
      return this.availabilityByType().get(row.type) ?? [];
    }
    // Custom (unlinked) catalog rows — serials come from the shared inventory store.
    const def = this.inventoryStore.byId(row.inventoryDefinitionId);
    return (def?.serialCodes ?? []).map((serialCode) => ({
      serialCode,
      isAvailable: true
    }));
  }

  protected serialPanelState(row: QuickLoanAccessoryRow): 'loading' | 'no-inventory' | 'all-booked' | 'options' {
    if (row.type && this.availabilityLoading() && this.serialOptionsForRow(row).length === 0) {
      return 'loading';
    }
    const options = this.serialOptionsForRow(row);
    if (options.length === 0) {
      return 'no-inventory';
    }
    const hasSelectable = options.some(
      (opt) => opt.isAvailable || this.isSerialSelected(row, opt.serialCode)
    );
    return hasSelectable ? 'options' : 'all-booked';
  }

  protected serialPanelEmptyMessage(row: QuickLoanAccessoryRow): string {
    const state = this.serialPanelState(row);
    if (state === 'no-inventory') {
      return 'אין מלאי במערכת מפריט זה';
    }
    if (state === 'all-booked') {
      return 'כל הפריטים כרגע בחוץ (מושאלים)';
    }
    return '';
  }

  protected isSerialSelected(row: QuickLoanAccessoryRow, code: string): boolean {
    return row.selectedCodes.some(
      (c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
    );
  }

  protected toggleSerialDropdown(row: QuickLoanAccessoryRow): void {
    if (this.openSerialDropdownId() === row.inventoryDefinitionId) {
      this.openSerialDropdownId.set(null);
      this.serialQuickEntry.set('');
      return;
    }

    this.openSerialDropdownId.set(row.inventoryDefinitionId);
    this.serialQuickEntry.set('');
    queueMicrotask(() => this.focusSerialQuickEntry());
  }

  protected onSerialPanelClick(event: Event): void {
    event.stopPropagation();
  }

  protected toggleSerialSelection(row: QuickLoanAccessoryRow, code: string, checked: boolean): void {
    this.accessoryRows.update((rows) =>
      rows.map((r) => {
        if (r.inventoryDefinitionId !== row.inventoryDefinitionId) {
          return r;
        }
        let next = [...r.selectedCodes];
        if (checked) {
          if (!next.some((c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0)) {
            next.push(code);
          }
        } else {
          next = next.filter((c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) !== 0);
        }
        const quantity = next.length > 0 ? next.length : r.quantity;
        return { ...r, selectedCodes: next, quantity };
      })
    );

    if (checked && row.type === LoanedEquipmentType.Mixer) {
      this.applyMixerDefaultAccessories(code);
    }
  }

  protected onSerialQuickEnter(row: QuickLoanAccessoryRow, event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const typed = this.serialQuickEntry().trim();
    if (!typed) {
      return;
    }

    const match = this.serialOptionsForRow(row).find(
      (opt) => opt.serialCode.localeCompare(typed, undefined, { sensitivity: 'accent' }) === 0
    );

    if (!match) {
      this.toast.warning(`קוד "${typed}" לא קיים במלאי לפריט זה`);
      return;
    }

    const alreadySelected = this.isSerialSelected(row, match.serialCode);
    if (!alreadySelected && !match.isAvailable) {
      this.toast.warning(`קוד "${match.serialCode}" אינו זמין `);
      return;
    }

    this.toggleSerialSelection(row, match.serialCode, !alreadySelected);
    this.serialQuickEntry.set('');
    queueMicrotask(() => this.focusSerialQuickEntry());
  }

  protected closeSerialDropdown(row: QuickLoanAccessoryRow, event?: Event): void {
    event?.stopPropagation();
    if (this.openSerialDropdownId() === row.inventoryDefinitionId) {
      this.openSerialDropdownId.set(null);
      this.serialQuickEntry.set('');
    }
  }

  protected formatPhone(phone: string | null | undefined): string {
    const digits = (phone ?? '').replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 9) {
      return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    }
    return phone ?? '';
  }

  protected orderDateLabel(order: OrderDto): string {
    const iso = order.shifts?.[0]?.orderDate;
    if (!iso) {
      return '—';
    }
    const date = this.hebrew.parseIso(iso);
    return date ? this.hebrew.formatGregorianWithDayName(date) : iso;
  }

  protected orderShiftLabel(order: OrderDto): string {
    const slot = order.shifts?.[0]?.timeSlot;
    return slot ? TIME_SLOT_LABELS[slot] : '';
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
    this.form.patchValue(
      {
        customerName: c.fullName ?? '',
        phone: c.phone1 ?? '',
        address: c.address ?? ''
      },
      { emitEvent: false }
    );
    this.closeCustomerSuggestions();
    this.toast.show('פרטי הלקוח מולאו מהרשימה', 'info');
  }

  private closeCustomerSuggestions(): void {
    this.customerSuggestOpen.set(false);
    this.customerSuggestIndex.set(-1);
    this.customerSuggestions.set([]);
    this.customerSuggestField.set(null);
  }

  protected orderAccessoryLines(order: OrderDto): { label: string; codes: string[]; quantity: number }[] {
    return (order.loanedEquipments ?? [])
      .filter((le) => le.quantity > 0)
      .map((le) => {
        const codes = (le.notes ?? [])
          .map((n) => (n.content ?? '').trim())
          .filter((c) => c.length > 0);
        const label = le.isCustomItem
          ? (le.customItemName?.trim() || 'פריט נוסף')
          : le.loanedEquipmentType
            ? this.inventoryStore.displayLabelForType(le.loanedEquipmentType)
            : 'פריט';
        return {
          label,
          codes,
          quantity: le.quantity
        };
      });
  }

  protected startEdit(order: OrderDto): void {
    this.editingId.set(order.id);
    this.openSerialDropdownId.set(null);
    this.serialQuickEntry.set('');
    this.deleteConfirmOrder.set(null);

    const shift = order.shifts?.[0];
    const iso = shift?.orderDate;
    if (iso) {
      const parts = this.hebrew.isoToHebrewParts(iso);
      if (parts) {
        this.ensureYearInOptions(parts.year);
        this.form.patchValue({
          hebrewYear: parts.year,
          hebrewMonth: parts.month,
          hebrewDay: parts.day
        });
        this.hebrewYearSig.set(parts.year);
        this.hebrewMonthSig.set(parts.month);
        this.hebrewDaySig.set(parts.day);
        this.monthOptions.set(this.hebrew.monthsForYear(parts.year));
        this.syncDayOptions();
      }
    }

    this.form.patchValue({
      customerName: order.customerName ?? '',
      phone: order.phone ?? '',
      address: order.address ?? '',
      notes: order.notes ?? ''
    });

    const catalog = this.inventoryStore.definitions();
    const rows: QuickLoanAccessoryRow[] = [];

    for (const le of order.loanedEquipments ?? []) {
      if (le.quantity <= 0) {
        continue;
      }
      const codes = (le.notes ?? [])
        .map((n) => (n.content ?? '').trim())
        .filter((c) => c.length > 0);

      if (le.isCustomItem) {
        const name = (le.customItemName ?? '').trim() || 'פריט נוסף';
        const def =
          catalog.find(
            (d) =>
              !d.linkedEquipmentType &&
              d.displayName.localeCompare(name, 'he', { sensitivity: 'accent' }) === 0
          ) ?? null;
        rows.push({
          inventoryDefinitionId: def?.id ?? this.nextOneTimeAccessoryId--,
          type: null,
          label: def?.displayName ?? name,
          quantity: Math.max(le.quantity, codes.length, 1),
          selectedCodes: codes,
          lineId: le.id
        });
        continue;
      }

      if (le.loanedEquipmentType == null) {
        continue;
      }
      const type = le.loanedEquipmentType;
      const def =
        catalog.find((d) => d.linkedEquipmentType === type) ??
        null;
      if (!def) {
        // Fallback: synthesize a row keyed by a negative pseudo-id so edit still works
        // until the catalog finishes loading.
        rows.push({
          inventoryDefinitionId: -LOANED_EQUIPMENT_ORDER.indexOf(type) - 1,
          type,
          label: LOANED_EQUIPMENT_LABELS[type] ?? String(type),
          quantity: Math.max(le.quantity, codes.length, 1),
          selectedCodes: codes,
          lineId: le.id
        });
        continue;
      }
      rows.push({
        inventoryDefinitionId: def.id,
        type,
        label: def.displayName,
        quantity: Math.max(le.quantity, codes.length, 1),
        selectedCodes: codes,
        lineId: le.id
      });
    }

    this.accessoryRows.set(rows);
    this.addAccessoryOpen.set(false);

    this.refreshAvailability();
    queueMicrotask(() => {
      this.document.getElementById('quick-loan-name')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.resetFormFully();
    this.refreshAvailability();
  }

  protected askDelete(order: OrderDto): void {
    this.deleteConfirmOrder.set(order);
  }

  protected openReturnForOrder(order: OrderDto): void {
    if (order.isCancelled) {
      this.toast.warning('לא ניתן לרשום החזרה להזמנה מבוטלת');
      return;
    }

    const useSavedReturns = order.isReturnProcessed === true;
    const rows: ReturnModalRow[] = (order.loanedEquipments ?? [])
      .filter((row) => row.quantity > 0 && row.id != null && row.id > 0)
      .map((row) => {
        const assignedSerialCodes = (row.notes ?? [])
          .map((n) => (n.content ?? '').trim())
          .filter((c) => c.length > 0);
        const isCustomItem = !!row.isCustomItem;
        const savedReturnedCodes = (row.notes ?? [])
          .filter((n) => n.isReturned && (n.content ?? '').trim().length > 0)
          .map((n) => (n.content ?? '').trim());
        const returnedSerialCodes = useSavedReturns ? savedReturnedCodes : [];
        const quantityReturned = useSavedReturns
          ? Math.min(Math.max(row.returnedQuantity ?? 0, 0), row.quantity)
          : 0;

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
          returnedSerialCodes
        };
      });

    if (rows.length === 0) {
      this.toast.show('אין ציוד מושאל להחזרה בהזמנה זו', 'info');
      return;
    }

    this.returnOrderId.set(order.id);
    this.returnRows.set(rows);
    this.returnSerialDropdownRowId.set(null);
    this.returnModalOpen.set(true);
  }

  protected closeReturnModal(): void {
    if (this.returnSaving()) {
      return;
    }
    this.returnSerialDropdownRowId.set(null);
    this.returnModalOpen.set(false);
    this.returnOrderId.set(null);
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
    return row.assignedSerialCodes.length > 0;
  }

  protected toggleReturnSerialDropdown(row: ReturnModalRow): void {
    this.returnSerialDropdownRowId.update((cur) => (cur === row.rowId ? null : row.rowId));
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

        const quantityReturned = Math.min(value, row.quantityLoaned);
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

  protected saveReturn(): void {
    const id = this.returnOrderId();
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
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.ordersSync.notifyOrderUpdated(updated);
        this.returnModalOpen.set(false);
        this.returnOrderId.set(null);
        this.toast.success('ההחזרה נשמרה בהצלחה');
        if (this.editingId() === id) {
          this.cancelEdit();
        }
        this.loadActiveLoans();
        this.refreshAvailability();
      });
  }

  protected closeDeleteConfirm(): void {
    if (this.deletingId()) {
      return;
    }
    this.deleteConfirmOrder.set(null);
  }

  protected confirmDelete(): void {
    const order = this.deleteConfirmOrder();
    if (!order || this.deletingId()) {
      return;
    }

    this.deletingId.set(order.id);
    this.data
      .deleteOrder(order.id)
      .pipe(finalize(() => this.deletingId.set(null)))
      .subscribe((ok) => {
        if (!ok) {
          return;
        }
        this.toast.success(`השאלה #${order.id} נמחקה`);
        this.deleteConfirmOrder.set(null);
        if (this.editingId() === order.id) {
          this.cancelEdit();
        }
        this.loadActiveLoans();
        this.refreshAvailability();
      });
  }

  protected submit(): void {
    if (this.submitting()) {
      return;
    }

    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.toast.warning('יש למלא טלפון תקין ותאריך לפני השמירה');
      return;
    }

    const iso = this.selectedIso();
    if (!iso) {
      this.toast.warning('תאריך לא תקין');
      return;
    }

    const loanedEquipments: OrderLoanedEquipmentDto[] = this.accessoryRows()
      .filter((row) => row.quantity > 0)
      .map((row) => {
        const codes = row.selectedCodes.map((c) => c.trim()).filter((c) => c.length > 0);
        if (row.type) {
          return {
            ...(row.lineId ? { id: row.lineId } : {}),
            isCustomItem: false,
            loanedEquipmentType: row.type,
            quantity: row.quantity,
            expectedNoteCount: row.quantity,
            notes: codes.map((code, ordinal) => ({
              ordinal,
              content: code,
              isReturned: false
            }))
          };
        }
        return {
          ...(row.lineId ? { id: row.lineId } : {}),
          isCustomItem: true,
          customItemName: row.label,
          loanedEquipmentType: null,
          quantity: row.quantity,
          expectedNoteCount: row.quantity,
          notes: codes.map((code, ordinal) => ({
            ordinal,
            content: code,
            isReturned: false
          }))
        };
      });

    if (loanedEquipments.length === 0) {
      this.toast.warning('יש להוסיף לפחות אביזר אחד עם כמות');
      return;
    }

    const shifts: OrderShiftDto[] = [
      {
        orderDate: iso,
        timeSlot: this.defaultTimeSlot
      }
    ];

    const payload: OrderCreateUpdateDto = {
      equipmentDefinitionIds: [],
      shifts,
      customerName: (this.form.controls.customerName.value ?? '').trim() || null,
      phone: (this.form.controls.phone.value ?? '').trim(),
      phone2: null,
      address: (this.form.controls.address.value ?? '').trim() || null,
      depositType: null,
      depositOnName: null,
      paymentAmount: null,
      isUnpaid: true,
      returnTimeType: ReturnTimeType.LateNight,
      customReturnTime: null,
      notes: (this.form.controls.notes.value ?? '').trim() || null,
      loanedEquipments,
      allowDoubleBooking: false
    };

    const editingId = this.editingId();
    this.submitting.set(true);
    const request$ =
      editingId != null
        ? this.data.updateOrder(editingId, payload)
        : this.data.createOrder(payload);

    request$.pipe(finalize(() => this.submitting.set(false))).subscribe((order) => {
      if (!order) {
        return;
      }
      this.ordersSync.notifyOrderUpdated(order);
      this.toast.success(
        editingId != null ? `השאלה #${order.id} עודכנה` : `השאלת ציוד נשמרה (#${order.id})`
      );
      this.resetFormFully();
      this.loadActiveLoans();
      this.refreshAvailability();
      this.inventoryStore.load({ force: true }).subscribe();
    });
  }

  private resetFormFully(): void {
    this.editingId.set(null);
    this.resetSelections();
    this.form.patchValue({
      customerName: '',
      phone: '',
      address: '',
      notes: ''
    });
    this.form.markAsUntouched();
  }

  private resetSelections(): void {
    this.accessoryRows.set([]);
    this.addAccessoryOpen.set(false);
    this.accessoryTypeQuery.set('');
    this.openSerialDropdownId.set(null);
    this.serialQuickEntry.set('');
  }

  private focusAccessoryTypeSearch(): void {
    const input = this.document.querySelector<HTMLInputElement>('.add-accessory__search');
    input?.focus();
  }

  protected refreshActiveLoans(): void {
    this.loadActiveLoans();
  }

  protected activeLoanDateLabel(iso: string): string {
    if (!iso) {
      return '—';
    }
    const date = this.hebrew.parseIso(iso);
    return date ? this.hebrew.formatGregorianWithDayName(date) : iso;
  }

  protected activeLoanHebrewDate(iso: string): string {
    if (!iso) {
      return '';
    }
    const date = this.hebrew.parseIso(iso);
    return date ? this.hebrew.toHebrew(date) : '';
  }

  protected isReturningLine(row: ActiveLoanRow): boolean {
    return this.returningLineKey() === row.key;
  }

  protected isRemovingLine(row: ActiveLoanRow): boolean {
    return this.removingLineKeys().has(row.key);
  }

  protected markLineReturned(row: ActiveLoanRow): void {
    if (this.returningLineKey() !== null) {
      return;
    }

    const assignedCodes = row.assignedSerialCodes;
    const hasSerializedLine = assignedCodes.length > 0;
    const quantityReturned = hasSerializedLine ? assignedCodes.length : row.quantity;

    this.returningLineKey.set(row.key);
    this.data
      .recordOrderReturn(row.orderId, {
        items: [
          {
            loanedEquipmentId: row.loanedEquipmentId,
            quantityReturned,
            ...(hasSerializedLine ? { returnedSerialCodes: [...assignedCodes] } : {})
          }
        ]
      })
      .pipe(finalize(() => this.returningLineKey.set(null)))
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.ordersSync.notifyOrderUpdated(updated);
        this.animateActiveLineOut(row.key);
        this.toast.success('הפריט סומן כהוחזר');
        if (this.editingId() === row.orderId) {
          this.cancelEdit();
        }
        this.loadActiveLoans();
        this.refreshAvailability();
        this.inventoryStore.load({ force: true }).subscribe();
      });
  }

  protected onQuickReturnKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.quickReturnCodeOpen.set(false);
      return;
    }
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    const options = this.quickReturnCodeOptions();
    const typed = this.quickReturnCode().trim();
    if (options.length === 1 && typed) {
      this.selectQuickReturnCode(options[0]);
    }
    this.searchQuickReturn();
  }

  protected onQuickReturnTypeChange(raw: string): void {
    const id = Number.parseInt(raw, 10);
    this.quickReturnTypeId.set(Number.isFinite(id) && id > 0 ? id : null);
    this.quickReturnCode.set('');
    this.quickReturnCodeOpen.set(false);
  }

  protected onQuickReturnCodeFocus(): void {
    if (this.quickReturnTypeId() != null) {
      this.quickReturnCodeOpen.set(true);
    }
  }

  protected onQuickReturnCodeBlur(): void {
    setTimeout(() => this.quickReturnCodeOpen.set(false), 150);
  }

  protected onQuickReturnCodeInput(raw: string): void {
    this.quickReturnCode.set(raw);
    if (this.quickReturnTypeId() != null) {
      this.quickReturnCodeOpen.set(true);
    }
  }

  protected selectQuickReturnCode(code: string, event?: Event): void {
    event?.preventDefault();
    this.quickReturnCode.set(code);
    this.quickReturnCodeOpen.set(false);
  }

  protected searchQuickReturn(): void {
    if (this.quickReturnSearching() || this.quickReturnSaving()) {
      return;
    }

    const def = this.quickReturnSelectedType();
    if (!def) {
      this.toast.warning('יש לבחור סוג אביזר');
      return;
    }

    const code = this.quickReturnCode().trim();
    if (!code) {
      this.toast.warning('יש לבחור או להזין קוד פריט');
      return;
    }

    const openFromRows = (): void => {
      const matches = this.findActiveLoansByAccessoryCode(code).filter((row) =>
        this.rowMatchesAccessoryType(row, def)
      );
      if (matches.length === 0) {
        this.toast.warning(`לא נמצאה השאלה פעילה עבור ${def.displayName} עם קוד "${code}"`);
        queueMicrotask(() => this.focusQuickReturnCodeInput());
        return;
      }

      const phoneKeys = new Set(
        matches.map((m) => this.normalizePhone(m.phone)).filter((p) => p.length > 0)
      );
      if (phoneKeys.size > 1) {
        this.toast.warning('נמצאו מספר לקוחות עם אותו קוד — בחרו מהרשימה למטה');
        queueMicrotask(() => this.focusQuickReturnCodeInput());
        return;
      }

      const match = matches[0];
      const phoneKey = this.normalizePhone(match.phone);
      const customerRows = this.activeLoanRows().filter(
        (row) => this.normalizePhone(row.phone) === phoneKey && phoneKey.length > 0
      );
      const items = this.buildQuickReturnItems(
        customerRows.length > 0 ? customerRows : [match],
        match,
        code
      );

      this.quickReturnSession.set({
        scannedCode: code,
        customerName: match.customerName,
        phone: match.phone,
        address: match.address,
        items
      });
    };

    // Always refresh from server so lookups see the latest active loans.
    this.quickReturnSearching.set(true);
    this.data
      .getQuickLoans()
      .pipe(finalize(() => this.quickReturnSearching.set(false)))
      .subscribe((orders) => {
        this.activeLoans.set(orders);
        this.activeLoading.set(false);
        openFromRows();
      });
  }

  protected closeQuickReturnModal(): void {
    if (this.quickReturnSaving()) {
      return;
    }
    this.quickReturnSession.set(null);
    queueMicrotask(() => this.focusQuickReturnCodeInput());
  }

  protected quickReturnScannedItem(session: QuickReturnSession): QuickReturnItem | null {
    return session.items.find((item) => item.isScannedMatch) ?? null;
  }

  protected quickReturnAdditionalItems(session: QuickReturnSession): QuickReturnItem[] {
    return session.items.filter((item) => !item.isScannedMatch);
  }

  protected toggleQuickReturnItem(key: string, checked: boolean): void {
    this.quickReturnSession.update((session) => {
      if (!session) {
        return session;
      }
      return {
        ...session,
        items: session.items.map((item) => {
          if (item.key !== key) {
            return item;
          }
          // Scanned match stays selected — it is the reason the dialog opened.
          if (item.isScannedMatch && !checked) {
            return item;
          }
          return { ...item, selected: checked };
        })
      };
    });
  }

  protected confirmQuickReturn(): void {
    const session = this.quickReturnSession();
    if (!session || this.quickReturnSaving()) {
      return;
    }

    const selected = session.items.filter((item) => item.selected);
    if (selected.length === 0) {
      this.toast.warning('יש לבחור לפחות אביזר אחד להחזרה');
      return;
    }

    type LineReturn = {
      orderId: number;
      loanedEquipmentId: number;
      serialCodes: string[];
      quantityOnly: number;
    };
    const byOrderLine = new Map<string, LineReturn>();

    for (const item of selected) {
      const lineKey = `${item.orderId}:${item.loanedEquipmentId}`;
      let entry = byOrderLine.get(lineKey);
      if (!entry) {
        entry = {
          orderId: item.orderId,
          loanedEquipmentId: item.loanedEquipmentId,
          serialCodes: [],
          quantityOnly: 0
        };
        byOrderLine.set(lineKey, entry);
      }
      if (item.serialCode) {
        if (
          !entry.serialCodes.some(
            (c) => c.localeCompare(item.serialCode!, undefined, { sensitivity: 'accent' }) === 0
          )
        ) {
          entry.serialCodes.push(item.serialCode);
        }
      } else {
        entry.quantityOnly += Math.max(1, item.quantity);
      }
    }

    const byOrder = new Map<number, LineReturn[]>();
    for (const entry of byOrderLine.values()) {
      const list = byOrder.get(entry.orderId) ?? [];
      list.push(entry);
      byOrder.set(entry.orderId, list);
    }

    const requests = [...byOrder.entries()].map(([orderId, lines]) =>
      this.data.recordOrderReturn(orderId, {
        items: lines.map((line) => {
          if (line.serialCodes.length > 0) {
            return {
              loanedEquipmentId: line.loanedEquipmentId,
              quantityReturned: line.serialCodes.length,
              returnedSerialCodes: [...line.serialCodes]
            };
          }
          return {
            loanedEquipmentId: line.loanedEquipmentId,
            quantityReturned: line.quantityOnly
          };
        })
      })
    );

    this.quickReturnSaving.set(true);
    forkJoin(requests)
      .pipe(finalize(() => this.quickReturnSaving.set(false)))
      .subscribe((results) => {
        const updated = results.filter((r): r is OrderDto => !!r);
        if (updated.length === 0) {
          return;
        }
        for (const order of updated) {
          this.ordersSync.notifyOrderUpdated(order);
          if (this.editingId() === order.id) {
            this.cancelEdit();
          }
        }
        this.quickReturnSession.set(null);
        this.resetQuickReturnSelection();
        this.toast.success(
          selected.length === 1
            ? 'הקוד הוחזר בהצלחה'
            : `${selected.length} קודים הוחזרו בהצלחה`
        );
        this.loadActiveLoans();
        this.refreshAvailability();
        this.inventoryStore.load({ force: true }).subscribe();
        queueMicrotask(() => this.focusQuickReturnCodeInput());
      });
  }

  private buildQuickReturnItems(
    customerRows: ActiveLoanRow[],
    match: ActiveLoanRow,
    scannedCode: string
  ): QuickReturnItem[] {
    const items: QuickReturnItem[] = [];

    for (const row of customerRows) {
      const outstandingCodes =
        row.assignedSerialCodes.length > 0 ? row.assignedSerialCodes : row.codes;

      if (outstandingCodes.length > 0) {
        for (const code of outstandingCodes) {
          const isScannedMatch =
            row.key === match.key &&
            code.localeCompare(scannedCode, undefined, { sensitivity: 'accent' }) === 0;
          items.push({
            key: `${row.key}::${code}`,
            orderId: row.orderId,
            loanedEquipmentId: row.loanedEquipmentId,
            accessoryName: row.accessoryName,
            serialCode: code,
            quantity: 1,
            selected: isScannedMatch,
            isScannedMatch
          });
        }
        continue;
      }

      // Quantity-only line (no serial codes): keep as a single selectable unit.
      const isScannedMatch = row.key === match.key;
      items.push({
        key: row.key,
        orderId: row.orderId,
        loanedEquipmentId: row.loanedEquipmentId,
        accessoryName: row.accessoryName,
        serialCode: null,
        quantity: row.quantity,
        selected: isScannedMatch,
        isScannedMatch
      });
    }

    // Put the scanned match first for readability.
    items.sort((a, b) => Number(b.isScannedMatch) - Number(a.isScannedMatch));
    return items;
  }

  private resetQuickReturnSelection(): void {
    this.quickReturnTypeId.set(null);
    this.quickReturnCode.set('');
    this.quickReturnCodeOpen.set(false);
  }

  private rowMatchesAccessoryType(row: ActiveLoanRow, def: InventoryDefinitionDto): boolean {
    if (
      row.accessoryName.localeCompare(def.displayName, 'he', { sensitivity: 'accent' }) === 0
    ) {
      return true;
    }
    const linked = def.linkedEquipmentType as LoanedEquipmentType | null | undefined;
    if (linked && LOANED_EQUIPMENT_ORDER.includes(linked)) {
      const linkedLabel = this.inventoryStore.displayLabelForType(linked);
      if (
        linkedLabel &&
        row.accessoryName.localeCompare(linkedLabel, 'he', { sensitivity: 'accent' }) === 0
      ) {
        return true;
      }
    }
    return false;
  }

  private findActiveLoansByAccessoryCode(rawCode: string): ActiveLoanRow[] {
    const code = rawCode.trim();
    if (!code) {
      return [];
    }

    return this.activeLoanRows().filter(
      (row) =>
        row.assignedSerialCodes.some(
          (c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
        ) ||
        row.codes.some(
          (c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
        )
    );
  }

  private normalizePhone(phone: string | null | undefined): string {
    return (phone ?? '').replace(/\D/g, '');
  }

  private focusQuickReturnCodeInput(): void {
    const input = this.document.getElementById(
      'quick-return-code-input'
    ) as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }

  private animateActiveLineOut(key: string): void {
    this.removingLineKeys.update((set) => new Set(set).add(key));
    window.setTimeout(() => {
      this.removingLineKeys.update((set) => {
        const next = new Set(set);
        next.delete(key);
        return next;
      });
    }, 280);
  }

  private buildActiveLoanRows(orders: OrderDto[]): ActiveLoanRow[] {
    const rows: ActiveLoanRow[] = [];
    for (const order of orders) {
      if (order.isReturnProcessed || order.isCancelled) {
        continue;
      }
      const loanDateIso = order.shifts?.[0]?.orderDate ?? '';
      const isOrderBased = (order.equipmentDefinitionIds?.length ?? 0) > 0;
      for (const le of order.loanedEquipments ?? []) {
        if (le.id == null || le.quantity <= 0) {
          continue;
        }
        const returned = le.returnedQuantity ?? 0;
        if (returned >= le.quantity) {
          continue;
        }
        const codes = (le.notes ?? [])
          .filter((n) => !n.isReturned)
          .map((n) => (n.content ?? '').trim())
          .filter((c) => c.length > 0);
        const allCodes = (le.notes ?? [])
          .map((n) => (n.content ?? '').trim())
          .filter((c) => c.length > 0);
        const accessoryName = le.isCustomItem
          ? (le.customItemName?.trim() || 'פריט נוסף')
          : le.loanedEquipmentType
            ? this.inventoryStore.displayLabelForType(le.loanedEquipmentType)
            : 'פריט';
        rows.push({
          key: `${order.id}-${le.id}`,
          orderId: order.id,
          loanedEquipmentId: le.id,
          customerName: order.customerName?.trim() || 'ללא שם',
          phone: order.phone,
          address: order.address?.trim() || '',
          accessoryName,
          quantity: le.quantity - returned,
          codes: codes.length > 0 ? codes : allCodes,
          loanDateIso,
          isCustomItem: !!le.isCustomItem,
          assignedSerialCodes: codes.length > 0 ? codes : allCodes,
          isOrderBased
        });
      }
    }
    return rows;
  }

  protected activeLoanOrderLabel(row: ActiveLoanRow): string {
    return row.isOrderBased ? `הזמנה #${row.orderId}` : `השאלה #${row.orderId}`;
  }

  private loadActiveLoans(): void {
    this.activeLoading.set(true);
    this.data
      .getQuickLoans()
      .pipe(finalize(() => this.activeLoading.set(false)))
      .subscribe((orders) => this.activeLoans.set(orders));
  }

  private focusSerialQuickEntry(): void {
    const input = this.document.querySelector<HTMLInputElement>(
      '.accessory-serial-panel .multi-select__quick-input'
    );
    input?.focus();
    input?.select();
  }

  private wireDateForm(): void {
    const yearCtrl = this.form.controls.hebrewYear;
    const monthCtrl = this.form.controls.hebrewMonth;
    const dayCtrl = this.form.controls.hebrewDay;

    yearCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((year) => {
      if (typeof year !== 'number') {
        return;
      }
      this.hebrewYearSig.set(year);
      this.monthOptions.set(this.hebrew.monthsForYear(year));
      const months = this.hebrew.monthsForYear(year);
      if (!months.some((m) => m.value === monthCtrl.value)) {
        monthCtrl.setValue(months[0]?.value ?? 1, { emitEvent: true });
      }
      this.syncDayOptions();
    });

    monthCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((month) => {
      if (typeof month !== 'number') {
        return;
      }
      this.hebrewMonthSig.set(month);
      this.syncDayOptions();
    });

    dayCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((day) => {
      if (typeof day === 'number') {
        this.hebrewDaySig.set(day);
      }
    });
  }

  private wireAvailabilityRefresh(): void {
    merge(
      this.form.controls.hebrewYear.valueChanges,
      this.form.controls.hebrewMonth.valueChanges,
      this.form.controls.hebrewDay.valueChanges
    )
      .pipe(
        startWith(null),
        debounceTime(200),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(() => this.refreshAvailability());
  }

  private wireCustomerAutocomplete(): void {
    const name$ = this.form.controls.customerName.valueChanges.pipe(
      map((v) => ({ field: 'name' as const, q: String(v ?? '').trim() }))
    );
    const phone$ = this.form.controls.phone.valueChanges.pipe(
      map((v) => ({ field: 'phone' as const, q: String(v ?? '').trim() }))
    );

    merge(name$, phone$)
      .pipe(
        debounceTime(300),
        switchMap(({ field, q }) => {
          if (q.length < 2) {
            this.closeCustomerSuggestions();
            return EMPTY;
          }
          return this.customers.searchSuggest(q).pipe(
            map((list) => ({
              field,
              q,
              list: list.slice(0, QuickLoanComponent.CUSTOMER_SUGGEST_LIMIT)
            }))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ field, q, list }) => {
        const current =
          field === 'name'
            ? String(this.form.controls.customerName.value ?? '').trim()
            : String(this.form.controls.phone.value ?? '').trim();
        if (current !== q) {
          return;
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

  private refreshAvailability(): void {
    const iso = this.selectedIso();
    if (!iso) {
      return;
    }

    const shifts: OrderShiftDto[] = [
      {
        orderDate: iso,
        timeSlot: this.defaultTimeSlot
      }
    ];

    this.availabilityLoading.set(true);
    this.data
      .getAccessorySerialAvailability({
        dates: [iso],
        shifts,
        equipmentTypes: [...LOANED_EQUIPMENT_ORDER],
        excludeOrderId: this.editingId()
      })
      .pipe(finalize(() => this.availabilityLoading.set(false)))
      .subscribe((groups) => {
        const map = new Map<LoanedEquipmentType, AccessorySerialOptionDto[]>();
        for (const group of groups) {
          map.set(group.equipmentType, group.options ?? []);
        }
        this.availabilityByType.set(map);
      });
  }

  private syncDayOptions(): void {
    const year = this.hebrewYearSig();
    const month = this.hebrewMonthSig();
    const count = this.hebrew.daysInMonth(month, year);
    const days = Array.from({ length: count }, (_, i) => i + 1);
    this.dayOptions.set(days);
    const day = this.form.controls.hebrewDay.value;
    if (typeof day === 'number' && day > count) {
      this.form.controls.hebrewDay.setValue(count);
    }
  }

  private hebrewPartsToIso(year: number, month: number, day: number): string | null {
    if (!year || !month || !day) {
      return null;
    }
    return this.hebrew.toIso(this.hebrew.toGregorian(year, month, day));
  }

  private buildYearOptions(): number[] {
    const current = this.initialHebrew.year;
    const base = Array.from({ length: 7 }, (_, i) => current - 2 + i);
    const extras = this.extraYearsSig().filter((y) => !base.includes(y));
    return [...base, ...extras].sort((a, b) => a - b);
  }

  private ensureYearInOptions(year: number): void {
    const options = this.buildYearOptions();
    if (!options.includes(year)) {
      this.extraYearsSig.update((years) => [...years, year]);
      this.yearOptions.set(this.buildYearOptions());
    }
  }
}
