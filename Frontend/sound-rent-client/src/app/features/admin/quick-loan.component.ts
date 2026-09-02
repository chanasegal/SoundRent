import { CommonModule, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, finalize, forkJoin, merge } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, startWith, switchMap } from 'rxjs/operators';

import { AccessorySerialOptionDto } from '../../core/models/accessory-inventory.model';
import { CustomerSuggestDto } from '../../core/models/customer.model';
import { InventoryDefinitionDto } from '../../core/models/inventory-definition.model';
import {
  LOANED_EQUIPMENT_LABELS,
  LOANED_EQUIPMENT_ORDER,
  LoanedEquipmentType,
  ReturnTimeType,
  SystemType,
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
import { OrderDraftService, QuickLoanDraftPayload } from '../../core/services/order-draft.service';
import { ToastService } from '../../core/services/toast.service';
import {
  ISRAELI_PHONE_INVALID_MESSAGE,
  israeliPhoneValidator
} from '../../core/validators/israeli-phone.validator';
import { compareNumericCodes, sortNumericCodes } from '../../core/utils/numeric-code-sort';
import { IntegerOnlyDirective } from '../../shared/directives/integer-only.directive';
import { IsraeliPhoneInputDirective } from '../../shared/directives/israeli-phone-input.directive';
import { ClickOutsideDirective } from '../../shared/directives/click-outside.directive';
import { HebrewCalendarPickerComponent } from '../../shared/hebrew-calendar-picker/hebrew-calendar-picker.component';

interface QuickLoanAccessoryRow {
  /** Catalog row id from InventoryDefinitions (shared store). */
  inventoryDefinitionId: number;
  /** Set when the catalog row is linked to a system LoanedEquipmentType. */
  type: LoanedEquipmentType | null;
  label: string;
  quantity: number;
  selectedCodes: string[];
  /** Codes assigned when the order was loaded for edit (stay selectable until save). */
  initialCodes?: string[];
  lineId?: number;
  /** Already-returned serials for this line — omitted from the form, restored on save. */
  preservedReturnedCodes?: string[];
  /** Already-returned quantity for this line — added back to quantity on save. */
  alreadyReturnedQuantity?: number;
}

interface AccessoryDraftLine {
  id: string;
  query: string;
  inventoryDefinitionId: number | null;
  selectedCodes: string[];
  suggestOpen: boolean;
  codesOpen: boolean;
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
  /** Codes already persisted as returned — stay selected and cannot be unchecked. */
  lockedReturnedSerialCodes: string[];
  /** Quantity already persisted as returned — quantity input cannot go below this. */
  alreadyReturnedQuantity: number;
}

/** Outstanding accessory line on a standalone quick-loan card (return actions). */
interface StandaloneLoanItem {
  key: string;
  orderId: number;
  loanedEquipmentId: number;
  accessoryName: string;
  quantity: number;
  quantityLoaned: number;
  assignedSerialCodes: string[];
  loanDateIso: string;
  /** Local loan time (HH:MM) from order creation timestamp. */
  loanTimeLabel: string;
}

interface StandaloneLoanCard {
  key: string;
  customerName: string;
  phone: string;
  address: string;
  /** Newest loan date among items — used for card ordering. */
  loanDateIso: string;
  orders: OrderDto[];
  items: StandaloneLoanItem[];
  totalQuantity: number;
  customerNotes: string | null;
  deposits: string[];
  loanNotes: string[];
}

interface DeleteConfirmOrder {
  orderIds: number[];
  cardKey: string;
  customerName: string;
  phone: string;
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
    IsraeliPhoneInputDirective,
    ClickOutsideDirective
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
  private readonly orderDraft = inject(OrderDraftService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly pageTitle = inject(WorkspaceUiService).title('השאלת אביזרים');

  private readonly initialHebrew = this.hebrew.toHebrewParts(new Date());
  private readonly extraYearsSig = signal<number[]>([]);
  private static readonly CUSTOMER_SUGGEST_LIMIT = 8;
  /** Placeholder slot stored with the loan date; accessory loans are not shift-bound. */
  private readonly defaultTimeSlot = TimeSlot.Morning;

  protected readonly hebrewYearSig = signal(this.initialHebrew.year);
  protected readonly hebrewMonthSig = signal(this.initialHebrew.month);
  protected readonly hebrewDaySig = signal(this.initialHebrew.day);

  protected readonly israeliPhoneInvalidMessage = ISRAELI_PHONE_INVALID_MESSAGE;

  protected readonly accessoryRows = signal<QuickLoanAccessoryRow[]>([]);
  protected readonly accessoryDraftLines = signal<AccessoryDraftLine[]>([
    this.createAccessoryDraftLine()
  ]);
  private nextOneTimeAccessoryId = -1;

  private readonly availabilityByDefinitionId = signal<
    Map<number, AccessorySerialOptionDto[]>
  >(new Map());
  private readonly availabilityLoading = signal(false);
  protected readonly openSerialDropdownId = signal<number | null>(null);
  protected readonly serialQuickEntry = signal('');
  protected readonly submitting = signal(false);
  protected readonly editingId = signal<number | null>(null);
  /** Other orders merged into the primary order during grouped-card edit (legacy; prefer one card per order). */
  protected readonly editingGroupedOrderIds = signal<number[]>([]);
  protected readonly editingCardKey = signal<string | null>(null);
  /** Fully-returned lines kept off the edit form but re-sent on save so they are not deleted. */
  private readonly editingPreservedReturnedLines = signal<OrderLoanedEquipmentDto[]>([]);
  protected readonly recentLoans = signal<OrderDto[]>([]);
  protected readonly recentLoading = signal(false);
  protected readonly returningLineKey = signal<string | null>(null);
  protected readonly removingLineKeys = signal<Set<string>>(new Set());
  protected readonly deletingCardKey = signal<string | null>(null);
  protected readonly deleteConfirmOrder = signal<DeleteConfirmOrder | null>(null);
  protected readonly formMinimized = signal(false);

  protected readonly returnModalOpen = signal(false);
  protected readonly returnSaving = signal(false);
  protected readonly returnOrderId = signal<number | null>(null);
  protected readonly returnRows = signal<ReturnModalRow[]>([]);
  protected readonly returnSerialDropdownRowId = signal<string | null>(null);

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
    deposit: ['', Validators.maxLength(100)],
    notes: ['', Validators.maxLength(1000)]
  });

  protected readonly yearOptions = signal(this.buildYearOptions());
  protected readonly monthOptions = signal(this.hebrew.monthsForYear(this.initialHebrew.year));
  protected readonly dayOptions = signal(
    Array.from({ length: this.hebrew.daysInMonth(this.initialHebrew.month, this.initialHebrew.year) }, (_, i) => i + 1)
  );

  /** Standalone accessory loans only (created on this page — no weekly-schedule equipment). */
  protected readonly standaloneLoans = computed(() =>
    this.recentLoans().filter((order) => (order.equipmentDefinitionIds?.length ?? 0) === 0)
  );

  protected readonly standaloneLoanCards = computed(() => {
    this.customers.customers();
    this.inventoryStore.definitions();
    return this.buildStandaloneLoanCards(this.standaloneLoans());
  });

  constructor() {
    effect(() => {
      this.orderDraft.resumeTick();
      untracked(() => this.tryRestoreMinimizedDraft());
    });
  }

  ngOnInit(): void {
    this.wireDateForm();
    this.wireAvailabilityRefresh();
    this.wireCustomerAutocomplete();
    this.inventoryStore.load({ force: true }).subscribe();
    this.customers.load().subscribe();
    this.refreshAvailability();
    this.loadRecentLoans();
    if (this.orderDraft.draft()?.kind === 'quick-loan' && this.orderDraft.showBar()) {
      this.formMinimized.set(true);
    }
    this.tryRestoreMinimizedDraft();
    this.readEditQueryParam();
  }

  /** Open an existing standalone accessory loan for edit (from loans list deep-link). */
  private readEditQueryParam(): void {
    const editId = Number(this.route.snapshot.queryParamMap.get('edit'));
    if (!Number.isFinite(editId) || editId <= 0) {
      return;
    }

    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { edit: null },
      replaceUrl: true
    });

    this.inventoryStore
      .load({ force: true })
      .pipe(switchMap(() => this.data.getOrderById(editId)))
      .subscribe((order) => {
        if (!order) {
          this.toast.error('ההשאלה לא נמצאה');
          return;
        }
        if ((order.equipmentDefinitionIds?.length ?? 0) > 0) {
          void this.router.navigate(['/orders', editId]);
          return;
        }
        this.orderDraft.clearIfKind('quick-loan');
        this.formMinimized.set(false);
        this.startEdit(order);
      });
  }

  /** Keep the standalone accessory loan available while using another area of the app. */
  protected minimizeDraft(): void {
    if (this.submitting()) {
      return;
    }

    this.orderDraft.minimize({
      kind: 'quick-loan',
      customerLabel: String(this.form.controls.customerName.value ?? '').trim(),
      resumePath: '/tools/accessory-lending',
      payload: {
        formValue: this.form.getRawValue() as Record<string, unknown>,
        accessoryRows: this.accessoryRows().map((row) => ({
          ...row,
          selectedCodes: [...row.selectedCodes],
          ...(row.initialCodes ? { initialCodes: [...row.initialCodes] } : {}),
          ...(row.preservedReturnedCodes
            ? { preservedReturnedCodes: [...row.preservedReturnedCodes] }
            : {}),
          ...(row.alreadyReturnedQuantity != null
            ? { alreadyReturnedQuantity: row.alreadyReturnedQuantity }
            : {})
        })),
        editingId: this.editingId(),
        nextOneTimeAccessoryId: this.nextOneTimeAccessoryId,
        preservedReturnedLines: this.editingPreservedReturnedLines().map((line) => ({
          ...line,
          notes: (line.notes ?? []).map((n) => ({ ...n }))
        }))
      }
    });
    this.closeDraftOnlyUi();
    this.formMinimized.set(true);
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

  protected filteredAccessoryTypesForDraft(line: AccessoryDraftLine): InventoryDefinitionDto[] {
    return this.filterAccessoryTypesForDraftLine(line, line.query);
  }

  protected showCustomAccessoryOptionForDraft(line: AccessoryDraftLine): boolean {
    const query = line.query.trim();
    if (query.length < 2 || line.inventoryDefinitionId != null) {
      return false;
    }
    if (this.parseFreeTextAccessoryEntry(query)) {
      return false;
    }
    const lower = query.toLowerCase();
    return !this.inventoryStore.definitions().some(
      (d) => d.displayName.trim().toLowerCase() === lower
    );
  }

  protected customAccessoryOptionLabelForDraft(line: AccessoryDraftLine): string {
    return `הוסף "${line.query.trim()}" להשאלה זו בלבד`;
  }

  protected accessoryTypeLabel(def: InventoryDefinitionDto): string {
    return def.displayName;
  }

  protected onDraftQueryInput(lineId: string, value: string): void {
    this.accessoryDraftLines.update((lines) =>
      lines.map((l) =>
        l.id !== lineId
          ? { ...l, suggestOpen: false, codesOpen: false }
          : {
              ...l,
              query: value,
              inventoryDefinitionId: null,
              selectedCodes: [],
              suggestOpen: true,
              codesOpen: false
            }
      )
    );
    this.tryAutoSelectSingleAccessoryMatch(lineId, value);
  }

  protected onDraftQueryFocus(lineId: string): void {
    this.accessoryDraftLines.update((lines) =>
      lines.map((l) => ({
        ...l,
        suggestOpen: l.id === lineId,
        codesOpen: false
      }))
    );
  }

  protected onDraftQueryEnter(lineId: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.commitDraftLineAndAddNext(lineId);
  }

  protected onDraftCodesEnter(lineId: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.commitDraftLineAndAddNext(lineId);
  }

  protected onAddDraftLineClick(event: Event): void {
    const activeLineId = this.activeDraftLineId();
    event.preventDefault();
    event.stopPropagation();
    if (activeLineId) {
      this.commitDraftLineAndAddNext(activeLineId);
      return;
    }
    this.accessoryDraftLines.update((lines) => [...lines, this.createAccessoryDraftLine()]);
  }

  protected selectAccessoryDefinition(
    lineId: string,
    def: InventoryDefinitionDto,
    event?: Event
  ): void {
    event?.preventDefault();
    this.patchDraftLine(lineId, {
      inventoryDefinitionId: def.id,
      query: def.displayName,
      selectedCodes: [],
      suggestOpen: false,
      codesOpen: false
    });
  }

  protected onCustomAccessoryDraftChosen(lineId: string, event?: Event): void {
    event?.preventDefault();
    this.commitDraftLineAndAddNext(lineId);
  }

  protected closeDraftSuggest(lineId: string): void {
    this.patchDraftLine(lineId, { suggestOpen: false });
  }

  protected closeDraftCodesDropdown(lineId: string): void {
    this.patchDraftLine(lineId, { codesOpen: false });
  }

  protected toggleDraftCodesDropdown(lineId: string, event: Event): void {
    event.stopPropagation();
    this.accessoryDraftLines.update((lines) =>
      lines.map((l) => ({
        ...l,
        codesOpen: l.id === lineId ? !l.codesOpen : false,
        suggestOpen: false
      }))
    );
  }

  protected toggleDraftCodeSelection(lineId: string, code: string, event: Event): void {
    event.stopPropagation();
    this.accessoryDraftLines.update((lines) =>
      lines.map((l) => {
        if (l.id !== lineId) {
          return l;
        }
        const selected = l.selectedCodes.includes(code)
          ? l.selectedCodes.filter((c) => c !== code)
          : [...l.selectedCodes, code];
        return { ...l, selectedCodes: selected };
      })
    );
  }

  protected isDraftCodeSelected(line: AccessoryDraftLine, code: string): boolean {
    return line.selectedCodes.includes(code);
  }

  protected serialOptionsForDraftLine(line: AccessoryDraftLine): AccessorySerialOptionDto[] {
    if (line.inventoryDefinitionId == null || line.inventoryDefinitionId <= 0) {
      return [];
    }
    const def = this.inventoryStore.byId(line.inventoryDefinitionId);
    if (!def) {
      return [];
    }
    const tempRow: QuickLoanAccessoryRow = {
      inventoryDefinitionId: line.inventoryDefinitionId,
      type: this.resolveLinkedEquipmentType(def),
      label: line.query,
      quantity: 1,
      selectedCodes: line.selectedCodes
    };
    return this.serialOptionsForRow(tempRow);
  }

  protected draftCodesPanelState(
    line: AccessoryDraftLine
  ): 'loading' | 'no-inventory' | 'all-booked' | 'options' {
    if (line.inventoryDefinitionId == null || line.inventoryDefinitionId <= 0) {
      return 'no-inventory';
    }
    if (this.availabilityLoading()) {
      return 'loading';
    }
    const options = this.serialOptionsForDraftLine(line);
    if (options.length === 0) {
      return 'no-inventory';
    }
    if (options.every((opt) => !opt.isAvailable)) {
      return 'all-booked';
    }
    return 'options';
  }

  protected removeDraftLine(lineId: string): void {
    this.accessoryDraftLines.update((lines) => {
      const next = lines.filter((l) => l.id !== lineId);
      return next.length > 0 ? next : [this.createAccessoryDraftLine()];
    });
  }

  private filterAccessoryTypesForDraftLine(
    line: AccessoryDraftLine,
    query: string
  ): InventoryDefinitionDto[] {
    const used = new Set([
      ...this.accessoryRows().map((r) => r.inventoryDefinitionId),
      ...this.accessoryDraftLines()
        .filter((l) => l.id !== line.id && l.inventoryDefinitionId != null)
        .map((l) => l.inventoryDefinitionId as number)
    ]);
    const q = query.trim().toLowerCase();
    return this.inventoryStore.definitions().filter((d) => {
      if (used.has(d.id)) {
        return false;
      }
      if (!q) {
        return true;
      }
      return d.displayName.toLowerCase().includes(q);
    });
  }

  /** When typing narrows suggestions to one accessory, select it without a manual click. */
  private tryAutoSelectSingleAccessoryMatch(lineId: string, query: string): void {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }

    const parsed = this.parseFreeTextAccessoryEntry(trimmed);
    if (parsed && parsed.codes.length > 0) {
      return;
    }

    const line = this.accessoryDraftLines().find((l) => l.id === lineId);
    if (!line) {
      return;
    }

    const matches = this.filterAccessoryTypesForDraftLine(line, query);
    if (matches.length !== 1) {
      return;
    }

    this.selectAccessoryDefinition(lineId, matches[0]);
  }

  private commitDraftLineAndAddNext(lineId: string): void {
    this.commitDraftLineFromText(lineId, { addNext: true });
  }

  /**
   * Commits in-progress draft rows before save so users are not blocked
   * when they forget to press Enter on the final accessory line.
   * @returns false when a non-empty draft could not be committed (toast already shown).
   */
  private commitPendingDraftLinesBeforeSave(): boolean {
    const pending = this.accessoryDraftLines().filter(
      (line) =>
        line.query.trim().length > 0 ||
        line.selectedCodes.length > 0 ||
        line.inventoryDefinitionId != null
    );
    for (const line of pending) {
      const result = this.commitDraftLineFromText(line.id, { addNext: false });
      if (result === 'failed') {
        return false;
      }
    }
    return true;
  }

  /**
   * @returns 'committed' | 'skipped' (empty line) | 'failed' (validation / incomplete).
   */
  private commitDraftLineFromText(
    lineId: string,
    options: { addNext: boolean } = { addNext: true }
  ): 'committed' | 'skipped' | 'failed' {
    const line = this.accessoryDraftLines().find((l) => l.id === lineId);
    if (!line) {
      return 'skipped';
    }

    const trimmed = line.query.trim();
    if (!trimmed) {
      if (options.addNext) {
        this.focusDraftInput(lineId);
      }
      return 'skipped';
    }

    const parsed = this.parseFreeTextAccessoryEntry(trimmed);
    let committed = false;

    if (parsed) {
      if (parsed.codes.length === 0) {
        if (line.selectedCodes.length > 0) {
          if (
            !this.validateSerialCodesForDefinition(
              parsed.def.id,
              line.selectedCodes,
              parsed.def.displayName
            )
          ) {
            if (options.addNext) {
              this.focusDraftInput(lineId);
            }
            return 'failed';
          }
          committed = this.appendAccessoryRowFromDefinition(parsed.def, [...line.selectedCodes]);
        } else {
          this.patchDraftLine(lineId, {
            inventoryDefinitionId: parsed.def.id,
            query: parsed.def.displayName,
            selectedCodes: [],
            suggestOpen: false,
            codesOpen: false
          });
          if (!options.addNext) {
            this.toast.warning(`יש לבחור לפחות קוד עבור "${parsed.def.displayName}"`);
          }
          this.scheduleFocusDraftCodesDropdown(lineId);
          return 'failed';
        }
      } else if (
        !this.validateSerialCodesForDefinition(parsed.def.id, parsed.codes, parsed.def.displayName)
      ) {
        if (options.addNext) {
          this.focusDraftInput(lineId);
        }
        return 'failed';
      } else {
        committed = this.appendAccessoryRowFromDefinition(parsed.def, [...parsed.codes]);
      }
    } else if (line.inventoryDefinitionId != null && line.inventoryDefinitionId > 0) {
      const def = this.inventoryStore.byId(line.inventoryDefinitionId);
      if (!def) {
        this.toast.error('הפריט לא נמצא במלאי');
        if (options.addNext) {
          this.focusDraftInput(lineId);
        }
        return 'failed';
      }
      if (line.selectedCodes.length === 0) {
        this.toast.warning(`יש לבחור לפחות קוד עבור "${def.displayName}"`);
        this.scheduleFocusDraftCodesDropdown(lineId);
        return 'failed';
      }
      if (
        !this.validateSerialCodesForDefinition(
          def.id,
          line.selectedCodes,
          def.displayName
        )
      ) {
        if (options.addNext) {
          this.focusDraftInput(lineId);
        }
        return 'failed';
      }
      committed = this.appendAccessoryRowFromDefinition(def, [...line.selectedCodes]);
    } else if (this.showCustomAccessoryOptionForDraft(line)) {
      const temporary = this.parseTemporaryAccessoryEntry(trimmed);
      const name = temporary?.name ?? trimmed;
      const codes =
        line.selectedCodes.length > 0
          ? [...line.selectedCodes]
          : temporary && temporary.codes.length > 0
            ? [...temporary.codes]
            : [];
      if (name.length < 2) {
        this.toast.warning('יש להזין לפחות שני תווים');
        if (options.addNext) {
          this.focusDraftInput(lineId);
        }
        return 'failed';
      }
      committed = this.appendCustomAccessoryRow(name, codes);
    } else {
      this.toast.warning('הקלידו שם אביזר ולפחות קוד אחד, למשל: מיקסר 123');
      if (options.addNext) {
        this.focusDraftInput(lineId);
      }
      return 'failed';
    }

    if (!committed) {
      if (options.addNext) {
        this.focusDraftInput(lineId);
      }
      return 'failed';
    }

    const nextLineId = `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.accessoryDraftLines.update((lines) => {
      const idx = lines.findIndex((l) => l.id === lineId);
      const fresh: AccessoryDraftLine = {
        id: nextLineId,
        query: '',
        inventoryDefinitionId: null,
        selectedCodes: [],
        suggestOpen: false,
        codesOpen: false
      };
      const next = lines.filter((l) => l.id !== lineId);
      next.splice(idx < 0 ? next.length : idx, 0, fresh);
      return next;
    });
    if (options.addNext) {
      this.scheduleFocusDraftInput(nextLineId);
    }
    return 'committed';
  }

  private parseFreeTextAccessoryEntry(
    raw: string
  ): { def: InventoryDefinitionDto; codes: string[] } | null {
    const input = raw.trim();
    if (!input) {
      return null;
    }

    const lower = input.toLocaleLowerCase();
    const defs = [...this.inventoryStore.definitions()].sort(
      (a, b) => b.displayName.trim().length - a.displayName.trim().length
    );

    for (const def of defs) {
      const name = def.displayName.trim();
      const lowerName = name.toLocaleLowerCase();
      if (!lower.startsWith(lowerName)) {
        continue;
      }

      const remainder = input.slice(name.length).replace(/^[\s\-:;,#/\\]+/, '').trim();
      if (!remainder) {
        return { def, codes: [] };
      }

      const codes = remainder
        .split(/[\s,;|/\\]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
      if (codes.length === 0) {
        continue;
      }

      return { def, codes };
    }

    return null;
  }

  private parseTemporaryAccessoryEntry(raw: string): { name: string; codes: string[] } | null {
    const input = raw.trim();
    if (!input || this.parseFreeTextAccessoryEntry(input)) {
      return null;
    }

    const tokens = input
      .split(/[\s,;|/\\]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    if (tokens.length === 0) {
      return null;
    }

    let splitAt = tokens.length;
    while (splitAt > 1 && /^[\d\-]+$/u.test(tokens[splitAt - 1])) {
      splitAt--;
    }

    const name = tokens.slice(0, splitAt).join(' ').trim();
    const codes = tokens.slice(splitAt);
    if (!name) {
      return null;
    }

    return { name, codes };
  }

  private appendAccessoryRowFromDefinition(
    def: InventoryDefinitionDto,
    selectedCodes: string[]
  ): boolean {
    if (this.accessoryRows().some((r) => r.inventoryDefinitionId === def.id)) {
      this.toast.warning('סוג אביזר זה כבר נוסף');
      return false;
    }

    const row: QuickLoanAccessoryRow = {
      inventoryDefinitionId: def.id,
      type: this.resolveLinkedEquipmentType(def),
      label: def.displayName,
      quantity: Math.max(1, selectedCodes.length),
      selectedCodes: [...selectedCodes]
    };
    this.accessoryRows.update((rows) => [...rows, row]);
    this.refreshAvailability();
    return true;
  }

  private appendCustomAccessoryRow(name: string, selectedCodes: string[]): boolean {
    if (
      this.accessoryRows().some((r) => r.label.trim().toLowerCase() === name.toLowerCase())
    ) {
      this.toast.warning('סוג אביזר זה כבר נוסף');
      return false;
    }

    const row: QuickLoanAccessoryRow = {
      inventoryDefinitionId: this.nextOneTimeAccessoryId--,
      type: null,
      label: name,
      quantity: Math.max(1, selectedCodes.length),
      selectedCodes: [...selectedCodes]
    };
    this.accessoryRows.update((rows) => [...rows, row]);
    this.toast.success(`"${name}" נוסף להשאלה זו בלבד`);
    return true;
  }

  private validateSerialCodesForDefinition(
    definitionId: number,
    codes: string[],
    label: string
  ): boolean {
    const def = this.inventoryStore.byId(definitionId);
    if (!def) {
      this.toast.error('הפריט לא נמצא במלאי');
      return false;
    }
    const tempRow: QuickLoanAccessoryRow = {
      inventoryDefinitionId: definitionId,
      type: this.resolveLinkedEquipmentType(def),
      label,
      quantity: 1,
      selectedCodes: []
    };
    const options = this.serialOptionsForRow(tempRow);
    if (options.length === 0) {
      return true;
    }

    for (const code of codes) {
      const match = options.find(
        (opt) => opt.serialCode.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
      );
      if (!match) {
        this.toast.error(`הקוד "${code}" לא שייך ל"${label}"`);
        return false;
      }
      if (!match.isAvailable) {
        this.toast.warning(`הקוד "${code}" אינו זמין כרגע להשאלה`);
        return false;
      }
    }
    return true;
  }

  private resolveLinkedEquipmentType(def: InventoryDefinitionDto): LoanedEquipmentType | null {
    return (
      LOANED_EQUIPMENT_ORDER.find(
        (type) =>
          def.displayName.trim().localeCompare(LOANED_EQUIPMENT_LABELS[type], 'he', {
            sensitivity: 'accent'
          }) === 0
      ) ?? null
    );
  }

  private patchDraftLine(lineId: string, patch: Partial<AccessoryDraftLine>): void {
    this.accessoryDraftLines.update((lines) =>
      lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l))
    );
  }

  private createAccessoryDraftLine(): AccessoryDraftLine {
    return {
      id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      query: '',
      inventoryDefinitionId: null,
      selectedCodes: [],
      suggestOpen: false,
      codesOpen: false
    };
  }

  private activeDraftLineId(): string | null {
    const active = this.document.activeElement as HTMLElement | null;
    if (!active) {
      return null;
    }
    const holder = active.closest<HTMLElement>('[data-accessory-draft-input][data-line-id]');
    return holder?.dataset['lineId'] ?? null;
  }

  private focusDraftInput(lineId: string): void {
    const input = this.document.querySelector<HTMLInputElement>(
      `[data-accessory-draft-input][data-line-id="${lineId}"]`
    );
    input?.focus();
    input?.select();
  }

  private scheduleFocusDraftInput(lineId: string): void {
    afterNextRender(
      () => {
        const input = this.document.querySelector<HTMLInputElement>(
          `[data-accessory-draft-input][data-line-id="${lineId}"]`
        );
        if (!input) {
          return;
        }
        input.scrollIntoView({ block: 'nearest' });
        input.focus({ preventScroll: true });
        input.select();
      },
      { injector: this.injector }
    );
  }

  private scheduleFocusDraftCodesDropdown(lineId: string): void {
    afterNextRender(
      () => {
        this.patchDraftLine(lineId, { codesOpen: true });
        const button = this.document.querySelector<HTMLButtonElement>(
          `[data-accessory-draft-codes] button[data-line-id="${lineId}"]`
        );
        if (!button) {
          return;
        }
        button.scrollIntoView({ block: 'nearest' });
        button.focus({ preventScroll: true });
      },
      { injector: this.injector }
    );
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
      const available = this.filterAvailableCodesForQuickLoan(
        {
          inventoryDefinitionId: def.id,
          type,
          label: def.displayName,
          quantity: 0,
          selectedCodes: []
        },
        codes
      );
      if (available.length === 0) {
        return { rows, changed: false };
      }
      return {
        rows: [
          ...rows,
          {
            inventoryDefinitionId: def.id,
            type,
            label: def.displayName,
            quantity: available.length,
            selectedCodes: [...available]
          }
        ],
        changed: true
      };
    }

    const existing = rows[index];
    const available = this.filterAvailableCodesForQuickLoan(existing, codes);
    const merged = [...existing.selectedCodes];
    let changed = false;
    for (const code of available) {
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

    const index = rows.findIndex((r) => r.inventoryDefinitionId === this.inventoryStore.definitionIdForType(type));
    if (index < 0) {
      const def = this.inventoryStore.definitionForType(type);
      if (!def) {
        return { rows, changed: false };
      }
      const available = this.filterAvailableCodesForQuickLoan(
        {
          inventoryDefinitionId: def.id,
          type,
          label: def.displayName,
          quantity: 0,
          selectedCodes: []
        },
        codes
      );
      if (available.length === 0) {
        return { rows, changed: false };
      }
      return {
        rows: [
          ...rows,
          {
            inventoryDefinitionId: def.id,
            type,
            label: def.displayName,
            quantity: available.length,
            selectedCodes: [...available]
          }
        ],
        changed: true
      };
    }

    const existing = rows[index];
    const available = this.filterAvailableCodesForQuickLoan(existing, codes);
    const merged = [...existing.selectedCodes];
    let changed = false;
    for (const code of available) {
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

  private filterAvailableCodesForQuickLoan(
    row: QuickLoanAccessoryRow,
    codes: string[]
  ): string[] {
    const options = this.serialOptionsForRow(row);
    const available: string[] = [];
    for (const code of codes) {
      const trimmed = code.trim();
      if (!trimmed) {
        continue;
      }
      if (row.selectedCodes.some((c) => c.localeCompare(trimmed, undefined, { sensitivity: 'accent' }) === 0)) {
        continue;
      }
      const match = options.find(
        (opt) => opt.serialCode.localeCompare(trimmed, undefined, { sensitivity: 'accent' }) === 0
      );
      if (match && !match.isAvailable) {
        continue;
      }
      if (!match && this.availabilityByDefinitionId().has(row.inventoryDefinitionId)) {
        continue;
      }
      available.push(trimmed);
    }
    return available;
  }

  protected removeAccessoryRow(row: QuickLoanAccessoryRow): void {
    this.accessoryRows.update((rows) =>
      rows.filter((r) => r.inventoryDefinitionId !== row.inventoryDefinitionId)
    );
    if (this.openSerialDropdownId() === row.inventoryDefinitionId) {
      this.openSerialDropdownId.set(null);
      this.serialQuickEntry.set('');
    }
    this.refreshAvailability();
  }

  protected isSerialDropdownOpen(row: QuickLoanAccessoryRow): boolean {
    return this.openSerialDropdownId() === row.inventoryDefinitionId;
  }

  protected serialOptionsForRow(row: QuickLoanAccessoryRow): AccessorySerialOptionDto[] {
    if (row.inventoryDefinitionId > 0) {
      const availabilityMap = this.availabilityByDefinitionId();
      if (availabilityMap.has(row.inventoryDefinitionId)) {
        return this.sortSerialOptions(availabilityMap.get(row.inventoryDefinitionId) ?? []);
      }
    }
    // Custom (unlinked) catalog rows — serials come from the shared inventory store.
    const def = this.inventoryStore.byId(row.inventoryDefinitionId);
    if (!def) {
      return [];
    }

    const reserved = new Set(
      [...(row.initialCodes ?? []), ...row.selectedCodes]
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
        .map((c) => c.toLowerCase())
    );

    const units = def.serialUnits ?? [];
    if (units.length > 0) {
      return this.sortSerialOptions(
        units.map((unit) => {
          const serialCode = unit.serialCode.trim();
          const status = unit.physicalStatus;
          const occupied = status === 'LoanedOut' || status === 'Missing' || status === 'InRepair';
          return {
            serialCode,
            isAvailable: !occupied || reserved.has(serialCode.toLowerCase())
          };
        })
      );
    }

    return this.sortSerialOptions(
      (def.serialCodes ?? []).map((serialCode) => ({
        serialCode,
        isAvailable: reserved.has(serialCode.trim().toLowerCase())
      }))
    );
  }

  private sortSerialOptions(options: AccessorySerialOptionDto[]): AccessorySerialOptionDto[] {
    return [...options].sort((a, b) => compareNumericCodes(a.serialCode, b.serialCode));
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
    if (
      row.inventoryDefinitionId > 0 &&
      !this.availabilityByDefinitionId().has(row.inventoryDefinitionId)
    ) {
      this.refreshAvailability();
    }
    queueMicrotask(() => this.focusSerialQuickEntry());
  }

  protected onSerialPanelClick(event: Event): void {
    event.stopPropagation();
  }

  protected toggleSerialSelection(row: QuickLoanAccessoryRow, code: string, checked: boolean): void {
    if (checked) {
      const match = this.serialOptionsForRow(row).find(
        (opt) => opt.serialCode.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
      );
      if (match && !match.isAvailable && !this.isSerialSelected(row, code)) {
        this.toast.warning(`קוד "${code}" כרגע תפוס ואינו זמין לבחירה`);
        return;
      }
    }

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
      this.toast.warning(`קוד "${match.serialCode}" כרגע תפוס ואינו זמין `);
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

  protected closeCustomerSuggestions(): void {
    this.customerSuggestOpen.set(false);
    this.customerSuggestIndex.set(-1);
    this.customerSuggestions.set([]);
    this.customerSuggestField.set(null);
  }

  protected closeReturnSerialDropdown(): void {
    this.returnSerialDropdownRowId.set(null);
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
    return slot != null ? TIME_SLOT_LABELS[slot] : '';
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
    return date ? this.hebrew.toHebrewWithDayOfWeek(date) : '';
  }

  /** Compact Hebrew date for a loan row, e.g. "כ״א אייר תשפ״ה". */
  protected itemHebrewDate(iso: string): string {
    if (!iso) {
      return '';
    }
    const date = this.hebrew.parseIso(iso);
    return date ? this.hebrew.toHebrew(date) : iso;
  }

  /** Loan time label (HH:MM, Asia/Jerusalem) from an ISO creation timestamp. */
  protected loanTimeFromCreatedAt(createdAt: string | null | undefined): string {
    const raw = createdAt?.trim();
    if (!raw) {
      return '';
    }
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleString('he-IL', {
      timeZone: 'Asia/Jerusalem',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  protected isReturningLine(row: StandaloneLoanItem): boolean {
    const key = this.returningLineKey();
    return (
      key === row.key ||
      key === this.orderReturnKey(row.orderId) ||
      (key?.startsWith(`${row.key}::`) ?? false)
    );
  }

  protected isReturningCode(row: StandaloneLoanItem, code: string): boolean {
    return this.returningLineKey() === this.codeReturnKey(row, code);
  }

  protected isReturningOrder(card: StandaloneLoanCard): boolean {
    return this.returningLineKey() === this.cardReturnKey(card.key);
  }

  protected isRemovingLine(row: StandaloneLoanItem): boolean {
    return this.removingLineKeys().has(row.key);
  }

  protected isRemovingCode(row: StandaloneLoanItem, code: string): boolean {
    return this.removingLineKeys().has(this.codeReturnKey(row, code));
  }

  protected isRemovingOrder(card: StandaloneLoanCard): boolean {
    return this.removingLineKeys().has(this.cardReturnKey(card.key));
  }

  protected isCardDeleting(card: StandaloneLoanCard): boolean {
    return this.deletingCardKey() === card.key;
  }

  protected isCardEditing(card: StandaloneLoanCard): boolean {
    return this.editingCardKey() === card.key;
  }

  protected isCardBusy(card: StandaloneLoanCard): boolean {
    return (
      this.isReturningOrder(card) ||
      this.isRemovingOrder(card) ||
      this.isCardDeleting(card) ||
      this.returningLineKey() !== null
    );
  }

  protected cardOrders(card: StandaloneLoanCard): OrderDto[] {
    return [...card.orders].sort((a, b) => a.id - b.id);
  }

  protected formatOrderIdList(orderIds: number[]): string {
    return orderIds.map((id) => `#${id}`).join(', ');
  }

  protected startEditCard(card: StandaloneLoanCard): void {
    const orders = this.cardOrders(card);
    if (orders.length === 0) {
      return;
    }
    if (orders.length > 1) {
      this.toast.error('לא ניתן לערוך מספר הזמנות בבת אחת — ערכו כל הזמנה בנפרד (#ID)');
      return;
    }
    this.applyEditOrders(orders, card.key);
  }

  protected askDeleteCard(card: StandaloneLoanCard): void {
    const orders = this.cardOrders(card);
    if (orders.length === 0) {
      return;
    }
    this.deleteConfirmOrder.set({
      orderIds: orders.map((order) => order.id),
      cardKey: card.key,
      customerName: card.customerName,
      phone: card.phone
    });
  }

  protected markLineReturned(row: StandaloneLoanItem): void {
    if (this.returningLineKey() !== null) {
      return;
    }

    const assignedCodes = row.assignedSerialCodes;
    const hasSerializedLine = assignedCodes.length > 0;
    const quantityReturned = hasSerializedLine ? assignedCodes.length : row.quantityLoaned;

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
        this.ordersSync.notifyLoanChanged();
        this.animateStandaloneLineOut(row.key);
        this.toast.success('הפריט סומן כהוחזר');
        if (this.editingId() === row.orderId) {
          this.cancelEdit();
        }
        this.loadRecentLoans();
        this.refreshAvailability();
        this.inventoryStore.load({ force: true }).subscribe();
      });
  }

  protected markCodeReturned(row: StandaloneLoanItem, code: string): void {
    if (this.returningLineKey() !== null) {
      return;
    }

    const trimmed = code.trim();
    if (!trimmed) {
      return;
    }

    const returnKey = this.codeReturnKey(row, trimmed);
    this.returningLineKey.set(returnKey);
    this.data
      .recordOrderReturn(row.orderId, {
        items: [
          {
            loanedEquipmentId: row.loanedEquipmentId,
            quantityReturned: 1,
            returnedSerialCodes: [trimmed]
          }
        ]
      })
      .pipe(finalize(() => this.returningLineKey.set(null)))
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.ordersSync.notifyOrderUpdated(updated);
        this.ordersSync.notifyLoanChanged();
        this.animateStandaloneLineOut(returnKey);
        this.toast.success(`קוד ${trimmed} סומן כהוחזר`);
        if (this.editingId() === row.orderId) {
          this.cancelEdit();
        }
        this.loadRecentLoans();
        this.refreshAvailability();
        this.inventoryStore.load({ force: true }).subscribe();
      });
  }

  protected markOrderAllReturned(card: StandaloneLoanCard): void {
    if (this.returningLineKey() !== null || card.items.length === 0) {
      return;
    }

    const requests = card.orders.map((order) => {
      const items = card.items
        .filter((row) => row.orderId === order.id)
        .map((row) => {
          const assignedCodes = row.assignedSerialCodes;
          if (assignedCodes.length > 0) {
            return {
              loanedEquipmentId: row.loanedEquipmentId,
              quantityReturned: assignedCodes.length,
              returnedSerialCodes: [...assignedCodes]
            };
          }
          return {
            loanedEquipmentId: row.loanedEquipmentId,
            quantityReturned: row.quantityLoaned
          };
        });
      return this.data.recordOrderReturn(order.id, { items });
    });

    const returnKey = this.cardReturnKey(card.key);
    this.returningLineKey.set(returnKey);
    forkJoin(requests)
      .pipe(finalize(() => this.returningLineKey.set(null)))
      .subscribe((updatedOrders) => {
        if (updatedOrders.some((order) => !order)) {
          return;
        }
        updatedOrders.forEach((order) => {
          if (order) {
            this.ordersSync.notifyOrderUpdated(order);
          }
        });
        this.ordersSync.notifyLoanChanged();
        this.animateStandaloneLineOut(returnKey);
        this.toast.success(
          card.items.length === 1
            ? 'כל הפריטים סומנו כהוחזרו'
            : `${card.totalQuantity} פריטים סומנו כהוחזרו`
        );
        if (this.editingCardKey() === card.key) {
          this.cancelEdit();
        }
        this.loadRecentLoans();
        this.refreshAvailability();
        this.inventoryStore.load({ force: true }).subscribe();
      });
  }

  private orderReturnKey(orderId: number): string {
    return `order:${orderId}`;
  }

  private cardReturnKey(cardKey: string): string {
    return `card:${cardKey}`;
  }

  private codeReturnKey(row: StandaloneLoanItem, code: string): string {
    return `${row.key}::${code.trim()}`;
  }

  private animateStandaloneLineOut(key: string): void {
    this.removingLineKeys.update((set) => new Set(set).add(key));
    window.setTimeout(() => {
      this.removingLineKeys.update((set) => {
        const next = new Set(set);
        next.delete(key);
        return next;
      });
    }, 280);
  }

  private buildStandaloneLoanCards(orders: OrderDto[]): StandaloneLoanCard[] {
    const byOrder = new Map<string, StandaloneLoanCard>();
    for (const order of orders) {
      if (order.isReturnProcessed || order.isCancelled) {
        continue;
      }
      const loanDateIso = order.shifts?.[0]?.orderDate ?? '';
      const items: StandaloneLoanItem[] = [];
      for (const le of order.loanedEquipments ?? []) {
        if (le.id == null || le.quantity <= 0) {
          continue;
        }
        const returned = le.returnedQuantity ?? 0;
        if (returned >= le.quantity) {
          continue;
        }
        const outstandingCodes = (le.notes ?? [])
          .filter((n) => !n.isReturned)
          .map((n) => (n.content ?? '').trim())
          .filter((c) => c.length > 0);
        const accessoryName = this.inventoryStore.displayLabelForLoanedLine(le);
        items.push({
          key: `${order.id}-${le.id}`,
          orderId: order.id,
          loanedEquipmentId: le.id,
          accessoryName,
          quantity: le.quantity - returned,
          quantityLoaned: le.quantity,
          assignedSerialCodes: outstandingCodes,
          loanDateIso,
          loanTimeLabel: this.loanTimeFromCreatedAt(order.createdAt)
        });
      }
      if (items.length === 0) {
        continue;
      }
      // One card per transaction/order ID so edits and returns never cross loans.
      const key = `order:${order.id}`;
      const card: StandaloneLoanCard = {
        key,
        customerName: order.customerName ?? '',
        phone: order.phone ?? '',
        address: (order.address ?? '').trim(),
        loanDateIso,
        orders: [order],
        items,
        totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
        customerNotes: this.customers.notesForPhone(order.phone),
        deposits: [],
        loanNotes: []
      };
      const deposit = (order.depositOnName ?? '').trim();
      if (deposit) {
        card.deposits.push(deposit);
      }
      const notes = (order.notes ?? '').trim();
      if (notes) {
        card.loanNotes.push(notes);
      }
      byOrder.set(key, card);
    }

    const cards = [...byOrder.values()];
    for (const card of cards) {
      this.sortStandaloneLoanItems(card.items);
      card.loanDateIso = card.items[0]?.loanDateIso ?? card.loanDateIso;
    }
    return cards.sort((a, b) => {
      const nameCmp = a.customerName.localeCompare(b.customerName, 'he');
      if (nameCmp !== 0) {
        return nameCmp;
      }
      const dateCmp = (b.loanDateIso || '').localeCompare(a.loanDateIso || '');
      if (dateCmp !== 0) {
        return dateCmp;
      }
      const aId = a.orders[0]?.id ?? 0;
      const bId = b.orders[0]?.id ?? 0;
      return bId - aId;
    });
  }

  private sortStandaloneLoanItems(items: StandaloneLoanItem[]): void {
    items.sort((a, b) => {
      const dateCmp = (b.loanDateIso || '').localeCompare(a.loanDateIso || '');
      if (dateCmp !== 0) {
        return dateCmp;
      }
      if (b.orderId !== a.orderId) {
        return b.orderId - a.orderId;
      }
      return a.accessoryName.localeCompare(b.accessoryName, 'he');
    });
  }

  protected startEdit(order: OrderDto): void {
    this.applyEditOrders([order], null);
  }

  private applyEditOrders(orders: OrderDto[], cardKey: string | null): void {
    const order = orders[0];
    if (!order) {
      return;
    }

    this.editingId.set(order.id);
    this.editingGroupedOrderIds.set(orders.length > 1 ? orders.slice(1).map((o) => o.id) : []);
    this.editingCardKey.set(cardKey);
    this.editingPreservedReturnedLines.set(this.collectFullyReturnedLines(orders));
    this.formMinimized.set(false);
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
      deposit: order.depositOnName ?? '',
      notes: order.notes ?? ''
    });

    const rows = orders.flatMap((entry) => this.buildEditRowsFromOrder(entry));
    this.accessoryRows.set(rows);
    this.accessoryDraftLines.set([this.createAccessoryDraftLine()]);

    this.refreshAvailability();
    queueMicrotask(() => {
      this.document.getElementById('quick-loan-name')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /** Fully-returned lines are hidden from the edit form but must be re-posted on save. */
  private collectFullyReturnedLines(orders: OrderDto[]): OrderLoanedEquipmentDto[] {
    const lines: OrderLoanedEquipmentDto[] = [];
    for (const order of orders) {
      for (const le of order.loanedEquipments ?? []) {
        if (le.id == null || le.id <= 0 || le.quantity <= 0) {
          continue;
        }
        const returned = Math.min(Math.max(le.returnedQuantity ?? 0, 0), le.quantity);
        if (returned < le.quantity) {
          continue;
        }
        const notes = (le.notes ?? [])
          .map((n, ordinal) => ({
            ordinal: n.ordinal ?? ordinal,
            content: (n.content ?? '').trim() || null,
            isReturned: !!n.isReturned
          }))
          .filter((n) => (n.content ?? '').length > 0 || n.isReturned);
        lines.push({
          id: le.id,
          isCustomItem: !!le.isCustomItem,
          customItemName: le.customItemName ?? null,
          loanedEquipmentType: le.loanedEquipmentType ?? null,
          inventoryDefinitionId: le.inventoryDefinitionId ?? null,
          quantity: le.quantity,
          expectedNoteCount: Math.max(le.expectedNoteCount ?? 0, notes.length, le.quantity),
          returnedQuantity: returned,
          notes
        });
      }
    }
    return lines;
  }

  private buildEditRowsFromOrder(order: OrderDto): QuickLoanAccessoryRow[] {
    const catalog = this.inventoryStore.definitions();
    const rows: QuickLoanAccessoryRow[] = [];

    for (const le of order.loanedEquipments ?? []) {
      if (le.quantity <= 0) {
        continue;
      }
      const returnedQty = Math.min(Math.max(le.returnedQuantity ?? 0, 0), le.quantity);
      // Fully returned lines stay off the form (preserved separately for save).
      if (returnedQty >= le.quantity) {
        continue;
      }

      const outstandingCodes = (le.notes ?? [])
        .filter((n) => !n.isReturned)
        .map((n) => (n.content ?? '').trim())
        .filter((c) => c.length > 0);
      const returnedCodes = (le.notes ?? [])
        .filter((n) => n.isReturned)
        .map((n) => (n.content ?? '').trim())
        .filter((c) => c.length > 0);
      const remainingQty = Math.max(le.quantity - returnedQty, 0);
      const activeQuantity =
        outstandingCodes.length > 0
          ? Math.max(outstandingCodes.length, 1)
          : Math.max(remainingQty, 1);
      const codes = outstandingCodes;

      if (le.isCustomItem) {
        const name = (le.customItemName ?? '').trim() || 'פריט נוסף';
        const catalogMatch = catalog.find(
          (d) => d.displayName.trim().localeCompare(name, 'he', { sensitivity: 'accent' }) === 0
        );
        if (catalogMatch) {
          const linkedType =
            LOANED_EQUIPMENT_ORDER.find(
              (type) =>
                catalogMatch.displayName.trim().localeCompare(LOANED_EQUIPMENT_LABELS[type], 'he', {
                  sensitivity: 'accent'
                }) === 0
            ) ?? null;
          rows.push({
            inventoryDefinitionId: catalogMatch.id,
            type: linkedType,
            label: catalogMatch.displayName,
            quantity: activeQuantity,
            selectedCodes: codes,
            initialCodes: [...codes],
            lineId: le.id,
            preservedReturnedCodes: [...returnedCodes],
            alreadyReturnedQuantity: returnedQty
          });
          continue;
        }
        rows.push({
          inventoryDefinitionId: this.nextOneTimeAccessoryId--,
          type: null,
          label: name,
          quantity: activeQuantity,
          selectedCodes: codes,
          initialCodes: [...codes],
          lineId: le.id,
          preservedReturnedCodes: [...returnedCodes],
          alreadyReturnedQuantity: returnedQty
        });
        continue;
      }

      const definitionId =
        le.inventoryDefinitionId != null && le.inventoryDefinitionId > 0
          ? le.inventoryDefinitionId
          : le.loanedEquipmentType != null
            ? this.inventoryStore.definitionIdForType(le.loanedEquipmentType)
            : null;
      const def = definitionId != null ? this.inventoryStore.byId(definitionId) ?? null : null;
      const type = le.loanedEquipmentType ?? null;
      if (!def && definitionId == null && type != null) {
        rows.push({
          inventoryDefinitionId: -LOANED_EQUIPMENT_ORDER.indexOf(type) - 1,
          type,
          label: LOANED_EQUIPMENT_LABELS[type] ?? String(type),
          quantity: activeQuantity,
          selectedCodes: codes,
          initialCodes: [...codes],
          lineId: le.id,
          preservedReturnedCodes: [...returnedCodes],
          alreadyReturnedQuantity: returnedQty
        });
        continue;
      }
      if (definitionId == null && !def) {
        continue;
      }
      rows.push({
        inventoryDefinitionId: def?.id ?? definitionId ?? this.nextOneTimeAccessoryId--,
        type,
        label: def?.displayName ?? (type ? LOANED_EQUIPMENT_LABELS[type] : String(type)),
        quantity: activeQuantity,
        selectedCodes: codes,
        initialCodes: [...codes],
        lineId: le.id,
        preservedReturnedCodes: [...returnedCodes],
        alreadyReturnedQuantity: returnedQty
      });
    }

    return rows;
  }

  protected cancelEdit(): void {
    this.clearEditState();
    this.resetFormFully();
    this.refreshAvailability();
  }

  protected askDelete(order: OrderDto): void {
    this.deleteConfirmOrder.set({
      orderIds: [order.id],
      cardKey: `order:${order.id}`,
      customerName: order.customerName ?? '',
      phone: order.phone ?? ''
    });
  }

  protected openReturnForOrder(order: OrderDto): void {
    if (order.isCancelled) {
      this.toast.warning('לא ניתן לרשום החזרה להזמנה מבוטלת');
      return;
    }

    const rows: ReturnModalRow[] = (order.loanedEquipments ?? [])
      .filter((row) => row.quantity > 0 && row.id != null && row.id > 0)
      .map((row) => {
        const assignedSerialCodes = sortNumericCodes(
          (row.notes ?? [])
            .map((n) => (n.content ?? '').trim())
            .filter((c) => c.length > 0)
        );
        const isCustomItem = !!row.isCustomItem;
        const lockedReturnedSerialCodes = sortNumericCodes(
          (row.notes ?? [])
            .filter((n) => n.isReturned && (n.content ?? '').trim().length > 0)
            .map((n) => (n.content ?? '').trim())
        );
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
          label: this.inventoryStore.displayLabelForLoanedLine(row),
          quantityLoaned: row.quantity,
          quantityReturned,
          isCustomItem,
          assignedSerialCodes,
          returnedSerialCodes,
          lockedReturnedSerialCodes,
          alreadyReturnedQuantity
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

  protected isReturnSerialLocked(row: ReturnModalRow, code: string): boolean {
    return row.lockedReturnedSerialCodes.some(
      (c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
    );
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
        this.ordersSync.notifyLoanChanged();
        this.returnModalOpen.set(false);
        this.returnOrderId.set(null);
        this.toast.success('ההחזרה נשמרה בהצלחה');
        if (this.editingId() === id) {
          this.cancelEdit();
        }
        this.loadRecentLoans();
        this.refreshAvailability();
      });
  }

  protected closeDeleteConfirm(): void {
    if (this.deletingCardKey()) {
      return;
    }
    this.deleteConfirmOrder.set(null);
  }

  protected confirmDelete(): void {
    const doomed = this.deleteConfirmOrder();
    if (!doomed || this.deletingCardKey()) {
      return;
    }

    this.deletingCardKey.set(doomed.cardKey);
    const requests = doomed.orderIds.map((orderId) => this.data.deleteOrder(orderId));
    forkJoin(requests)
      .pipe(finalize(() => this.deletingCardKey.set(null)))
      .subscribe((results) => {
        const okCount = results.filter((ok) => ok).length;
        if (okCount === 0) {
          return;
        }
        this.toast.success(
          doomed.orderIds.length === 1
            ? `השאלה #${doomed.orderIds[0]} נמחקה`
            : `${okCount} השאלות נמחקו (${this.formatOrderIdList(doomed.orderIds)})`
        );
        this.deleteConfirmOrder.set(null);
        if (this.editingCardKey() === doomed.cardKey) {
          this.cancelEdit();
        }
        this.loadRecentLoans();
        this.refreshAvailability();
      });
  }

  private clearEditState(): void {
    this.editingId.set(null);
    this.editingGroupedOrderIds.set([]);
    this.editingCardKey.set(null);
    this.editingPreservedReturnedLines.set([]);
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

    // Commit any in-progress draft row (Enter not pressed) before building the payload.
    if (!this.commitPendingDraftLinesBeforeSave()) {
      return;
    }

    const loanedEquipments: OrderLoanedEquipmentDto[] = this.accessoryRows()
      .filter((row) => row.quantity > 0)
      .map((row) => {
        const activeCodes = row.selectedCodes.map((c) => c.trim()).filter((c) => c.length > 0);
        const returnedCodes = (row.preservedReturnedCodes ?? [])
          .map((c) => c.trim())
          .filter((c) => c.length > 0)
          .filter(
            (code) =>
              !activeCodes.some(
                (active) => active.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
              )
          );
        const alreadyReturned = Math.max(0, row.alreadyReturnedQuantity ?? 0);
        const notes = [
          ...activeCodes.map((code, ordinal) => ({
            ordinal,
            content: code,
            isReturned: false
          })),
          ...returnedCodes.map((code, index) => ({
            ordinal: activeCodes.length + index,
            content: code,
            isReturned: true
          }))
        ];
        const quantity = Math.max(row.quantity + alreadyReturned, notes.length, 1);

        // Catalog rows (positive definition id) must never be saved as custom —
        // otherwise availability ignores them via IsCustomItem.
        if (row.inventoryDefinitionId > 0) {
          const linkedType =
            row.type ??
            LOANED_EQUIPMENT_ORDER.find(
              (type) =>
                row.label.trim().localeCompare(LOANED_EQUIPMENT_LABELS[type], 'he', {
                  sensitivity: 'accent'
                }) === 0
            ) ??
            null;
          return {
            ...(row.lineId ? { id: row.lineId } : {}),
            isCustomItem: false,
            inventoryDefinitionId: row.inventoryDefinitionId,
            loanedEquipmentType: linkedType,
            customItemName: null,
            quantity,
            expectedNoteCount: quantity,
            notes
          };
        }

        return {
          ...(row.lineId ? { id: row.lineId } : {}),
          isCustomItem: true,
          customItemName: row.label,
          loanedEquipmentType: null,
          inventoryDefinitionId: null,
          quantity,
          expectedNoteCount: quantity,
          notes
        };
      });

    const preservedReturned = this.editingPreservedReturnedLines();
    if (preservedReturned.length > 0) {
      const activeLineIds = new Set(
        loanedEquipments.map((le) => le.id).filter((id): id is number => id != null && id > 0)
      );
      for (const line of preservedReturned) {
        if (line.id != null && line.id > 0 && activeLineIds.has(line.id)) {
          continue;
        }
        loanedEquipments.push(line);
      }
    }

    if (loanedEquipments.length === 0) {
      this.toast.warning('יש להוסיף לפחות אביזר אחד עם כמות');
      return;
    }

    for (const row of this.accessoryRows()) {
      if (row.quantity <= 0) {
        continue;
      }
      const def = this.inventoryStore.byId(row.inventoryDefinitionId);
      const hasRegisteredSerials =
        (def?.serialUnits?.length ?? 0) > 0 || (def?.serialCodes?.length ?? 0) > 0;
      const codes = row.selectedCodes.map((c) => c.trim()).filter((c) => c.length > 0);
      if (hasRegisteredSerials && codes.length !== row.quantity) {
        this.toast.warning(`יש לבחור קוד לכל יחידה עבור "${row.label}"`);
        return;
      }
      const options = this.serialOptionsForRow(row);
      for (const code of codes) {
        const match = options.find(
          (opt) => opt.serialCode.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
        );
        if (match && !match.isAvailable) {
          this.toast.warning(`קוד "${code}" כרגע תפוס ואינו זמין לבחירה (${row.label})`);
          return;
        }
      }
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
      depositOnName: (this.form.controls.deposit.value ?? '').trim() || null,
      paymentAmount: null,
      isUnpaid: false,
      // Accessory loans are date-based only; shift/return-time rules do not apply.
      returnTimeType: ReturnTimeType.LateNight,
      customReturnTime: null,
      notes: (this.form.controls.notes.value ?? '').trim() || null,
      loanedEquipments,
      allowDoubleBooking: false,
      systemType: SystemType.Tools
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
      const groupedIds = this.editingGroupedOrderIds();
      const finishSave = (): void => {
        this.toast.success(
          editingId != null ? `השאלה #${order.id} עודכנה` : `השאלת ציוד נשמרה (#${order.id})`
        );
        this.orderDraft.clearIfKind('quick-loan');
        this.resetFormFully();
        this.loadRecentLoans();
        this.refreshAvailability();
        this.inventoryStore.load({ force: true }).subscribe();
      };

      if (editingId != null && groupedIds.length > 0) {
        forkJoin(groupedIds.map((orderId) => this.data.deleteOrder(orderId))).subscribe((results) => {
          const okCount = results.filter((ok) => ok).length;
          if (okCount < groupedIds.length) {
            this.toast.error('חלק מההשאלות המאוחדות לא נמחקו — ייתכן שיופיעו כפילויות');
          }
          finishSave();
        });
        return;
      }

      finishSave();
    });
  }

  private resetFormFully(): void {
    this.clearEditState();
    this.formMinimized.set(false);
    this.resetSelections();
    this.form.patchValue({
      customerName: '',
      phone: '',
      address: '',
      deposit: '',
      notes: ''
    });
    this.form.markAsUntouched();
  }

  /** Restore the form exactly once after the global draft bar requests it. */
  private tryRestoreMinimizedDraft(): void {
    const draft = this.orderDraft.takePendingRestore<QuickLoanDraftPayload>('quick-loan');
    if (!draft) {
      return;
    }

    const raw = draft.formValue ?? {};
    const year = Number(raw['hebrewYear']);
    const month = Number(raw['hebrewMonth']);
    const day = Number(raw['hebrewDay']);
    if (Number.isFinite(year) && year > 0) {
      this.ensureYearInOptions(year);
    }

    this.form.patchValue({
      customerName: String(raw['customerName'] ?? ''),
      phone: String(raw['phone'] ?? ''),
      address: String(raw['address'] ?? ''),
      deposit: String(raw['deposit'] ?? ''),
      notes: String(raw['notes'] ?? ''),
      ...(Number.isFinite(year) && year > 0 ? { hebrewYear: year } : {}),
      ...(Number.isFinite(month) && month > 0 ? { hebrewMonth: month } : {}),
      ...(Number.isFinite(day) && day > 0 ? { hebrewDay: day } : {})
    });
    const restoredYear = this.form.controls.hebrewYear.value;
    const restoredMonth = this.form.controls.hebrewMonth.value;
    const restoredDay = this.form.controls.hebrewDay.value;
    if (
      typeof restoredYear === 'number' &&
      typeof restoredMonth === 'number' &&
      typeof restoredDay === 'number'
    ) {
      this.hebrewYearSig.set(restoredYear);
      this.hebrewMonthSig.set(restoredMonth);
      this.hebrewDaySig.set(restoredDay);
      this.monthOptions.set(this.hebrew.monthsForYear(restoredYear));
      this.syncDayOptions();
    }
    this.editingId.set(draft.editingId);
    this.nextOneTimeAccessoryId = Number.isFinite(draft.nextOneTimeAccessoryId)
      ? draft.nextOneTimeAccessoryId
      : -1;
    this.editingPreservedReturnedLines.set(
      (draft.preservedReturnedLines ?? []).map((line) => ({
        ...line,
        notes: (line.notes ?? []).map((n) => ({ ...n }))
      }))
    );
    this.accessoryRows.set(
      (draft.accessoryRows ?? []).map((row) => ({
        inventoryDefinitionId: row.inventoryDefinitionId,
        type: row.type as LoanedEquipmentType | null,
        label: row.label,
        quantity: Math.max(1, Number(row.quantity) || 1),
        selectedCodes: [...(row.selectedCodes ?? [])],
        ...(row.initialCodes ? { initialCodes: [...row.initialCodes] } : {}),
        ...(row.lineId ? { lineId: row.lineId } : {}),
        ...(row.preservedReturnedCodes
          ? { preservedReturnedCodes: [...row.preservedReturnedCodes] }
          : {}),
        ...(row.alreadyReturnedQuantity != null
          ? { alreadyReturnedQuantity: Number(row.alreadyReturnedQuantity) || 0 }
          : {})
      }))
    );
    this.closeDraftOnlyUi();
    this.formMinimized.set(false);
    this.refreshAvailability();
    queueMicrotask(() => this.document.getElementById('quick-loan-name')?.focus());
  }

  private closeDraftOnlyUi(): void {
    this.accessoryDraftLines.set([this.createAccessoryDraftLine()]);
    this.openSerialDropdownId.set(null);
    this.serialQuickEntry.set('');
    this.closeCustomerSuggestions();
  }

  private resetSelections(): void {
    this.accessoryRows.set([]);
    this.accessoryDraftLines.set([this.createAccessoryDraftLine()]);
    this.openSerialDropdownId.set(null);
    this.serialQuickEntry.set('');
  }

  protected refreshRecentLoans(): void {
    this.loadRecentLoans();
  }

  private loadRecentLoans(): void {
    this.recentLoading.set(true);
    this.data
      .getQuickLoans()
      .pipe(finalize(() => this.recentLoading.set(false)))
      .subscribe((orders) => this.recentLoans.set(orders));
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

    const definitionIds = this.collectFormInventoryDefinitionIds();
    if (definitionIds.length === 0) {
      this.availabilityByDefinitionId.set(new Map());
      this.availabilityLoading.set(false);
      return;
    }

    this.availabilityLoading.set(true);
    this.data
      .getAccessorySerialAvailability({
        dates: [iso],
        inventoryDefinitionIds: definitionIds,
        excludeOrderId: this.editingId()
      })
      .pipe(finalize(() => this.availabilityLoading.set(false)))
      .subscribe((groups) => {
        const map = new Map<number, AccessorySerialOptionDto[]>();
        for (const group of groups) {
          const id = group.inventoryDefinitionId;
          if (id != null && id > 0) {
            map.set(id, group.options ?? []);
          }
        }
        this.availabilityByDefinitionId.set(map);
      });
  }

  /** Positive catalog ids for rows currently on the quick-loan form. */
  private collectFormInventoryDefinitionIds(): number[] {
    const ids = new Set<number>();
    for (const row of this.accessoryRows()) {
      if (Number.isFinite(row.inventoryDefinitionId) && row.inventoryDefinitionId > 0) {
        ids.add(row.inventoryDefinitionId);
        continue;
      }
      if (row.type != null) {
        const fromType = this.inventoryStore.definitionIdForType(row.type);
        if (fromType != null && fromType > 0) {
          ids.add(fromType);
        }
      }
    }
    return [...ids];
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
