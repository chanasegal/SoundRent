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
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, forkJoin, interval, merge, Subject, EMPTY } from 'rxjs';
import { debounceTime, distinctUntilChanged, groupBy, map, mergeMap, switchMap } from 'rxjs/operators';

import { CustomerSuggestDto } from '../../core/models/customer.model';
import { DEPOSIT_TYPE_LABELS, DepositType, SystemType } from '../../core/models/enums';
import { InstitutionDto } from '../../core/models/institution.model';
import {
  ToolDefinitionDto,
  ToolLoanCreateDto,
  ToolLoanDto,
  ToolLoanItemDto
} from '../../core/models/tools-workspace.model';
import { OrderDto } from '../../core/models/order.model';
import { CustomersStore } from '../../core/services/customers.store';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { InventoryDefinitionsStore } from '../../core/services/inventory-definitions.store';
import { OrdersSyncService } from '../../core/services/orders-sync.service';
import {
  OrderDraftService,
  WorkspaceLendingDraftPayload
} from '../../core/services/order-draft.service';
import { ToolDefinitionsStore } from '../../core/services/tool-definitions.store';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import { formatCalendarDuration } from '../../core/utils/tools-billable-duration';
import {
  buildCustomerRiskAlertSnapshot,
  CustomerRiskAlertSnapshot,
  digitsOnlyPhone,
  EMPTY_CUSTOMER_RISK_ALERTS
} from '../../core/utils/customer-risk-alerts';
import { sortNumericCodes } from '../../core/utils/numeric-code-sort';
import {
  findHammerDrillBitTool,
  formHasHammerDrill,
  isHammerDrillBitDisplayName,
  matchingHammerDrillBitTools,
  parseHammerDrillBitShortcutInput,
  shouldAutoCompleteHammerDrillBitName
} from '../../core/utils/hammer-drill-bit-shortcut';
import { startLiveDataRefresh } from '../../core/utils/live-data-refresh';
import { LoanRangeCalendarHostComponent } from '../../shared/components/loan-range-calendar-host.component';
import { ClickOutsideDirective } from '../../shared/directives/click-outside.directive';
import { IsraeliPhoneInputDirective } from '../../shared/directives/israeli-phone-input.directive';
import { clampIsraeliPhoneDigits, ISRAELI_PHONE_INVALID_MESSAGE, isValidIsraeliPhone } from '../../core/validators/israeli-phone.validator';

interface ToolLineItem {
  id: string;
  toolId: number | null;
  toolQuery: string;
  selectedCodes: string[];
  isTemporary: boolean;
  toolSuggestOpen: boolean;
  codesOpen: boolean;
}

interface LendingDraftForm {
  id: string;
  createdAt: Date;
  hebrewDateTime: string;
  toolLines: ToolLineItem[];
  clientName: string;
  phone: string;
  phone2: string;
  address: string;
  institutionName: string;
  institutionId: number | null;
  deposit: string;
  notes: string;
  clientAlertNotes: string | null;
  clientRiskAlerts: CustomerRiskAlertSnapshot;
  deadlineAt: Date | null;
}

interface ActiveLoanRowView {
  rowKey: string;
  loanId: number;
  itemId: number | null;
  /** Orders-backend loaned-equipment line id for accessory loans. */
  loanedEquipmentId: number | null;
  item: ToolLoanItemDto;
  source: 'tools' | 'accessory';
  /** Active serials on an accessory order line, if it is serialized. */
  activeSerialCodes: string[];
  quantity: number;
  /** Original loaned quantity on the accessory order line (not remaining). */
  quantityLoaned: number;
  clientName: string;
  phone: string;
  address: string;
  lentAt: Date;
  hebrewLentDisplay: string;
  deadlineAt: Date | null;
  returning: boolean;
  deposit: string | null;
  loanNotes: string | null;
}

interface ActiveLoanCustomerCard {
  key: string;
  customerName: string;
  phone: string;
  address: string;
  loanDate: Date;
  customerNotes: string | null;
  deposit: string | null;
  loanNotes: string | null;
  items: ActiveLoanRowView[];
}

interface QuickReturnItem {
  key: string;
  loanId: number;
  itemId: number;
  toolDefinitionId: number;
  toolName: string;
  serialCode: string;
  loanDateIso: string;
  hebrewDate: string;
  selected: boolean;
  isScannedMatch: boolean;
}

interface QuickReturnLoanGroup {
  dateKey: string;
  loanDateIso: string;
  hebrewDate: string;
  items: QuickReturnItem[];
}

interface QuickReturnSession {
  scannedCode: string;
  customerName: string;
  phone: string;
  address: string;
  items: QuickReturnItem[];
}

@Component({
  selector: 'app-tools-lending',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IsraeliPhoneInputDirective,
    ClickOutsideDirective,
    LoanRangeCalendarHostComponent
  ],
  templateUrl: './tools-lending.component.html',
  styleUrl: './tools-lending.component.scss'
})
export class ToolsLendingComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly toolStore = inject(ToolDefinitionsStore);
  private readonly inventoryStore = inject(InventoryDefinitionsStore);
  private readonly customers = inject(CustomersStore);
  private readonly ordersSync = inject(OrdersSyncService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly orderDraft = inject(OrderDraftService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  protected readonly pageTitle = inject(WorkspaceUiService).title('לוח השאלות');

  private pendingRenew: {
    phone: string;
    clientName: string;
    phone2: string;
    address: string;
    toolId: number;
    serialCode: string;
  } | null = null;

  protected readonly definitions = this.toolStore.definitions;
  protected readonly availableByTool = signal<Map<number, string[]>>(new Map());
  protected readonly submittingId = signal<string | null>(null);
  /** Declared before `forms` — `createDraftForm()` reads this during field init. */
  protected readonly timeLimitEnabled = signal(false);
  protected readonly activeLoading = signal(true);
  protected readonly activeLoans = signal<ToolLoanDto[]>([]);
  /** Accessory lending uses the shared Orders backend, not the Tools-loans backend. */
  protected readonly activeAccessoryLoans = signal<OrderDto[]>([]);
  protected readonly returningItemId = signal<number | null>(null);
  protected readonly returningAccessoryKey = signal<string | null>(null);
  protected readonly returningCustomerKey = signal<string | null>(null);
  protected readonly nowTick = signal(Date.now());
  protected readonly customerSuggestions = signal<CustomerSuggestDto[]>([]);
  protected readonly customerSuggestOpen = signal(false);
  protected readonly customerSuggestField = signal<'name' | 'phone' | null>(null);
  protected readonly customerSuggestFormId = signal<string | null>(null);
  private readonly customerSuggestQuery$ = new Subject<{
    formId: string;
    field: 'name' | 'phone';
    q: string;
  }>();

  private readonly customerRiskLookup$ = new Subject<{
    formId: string;
    phone: string;
    customerName: string;
  }>();

  protected readonly institutionSuggestions = signal<InstitutionDto[]>([]);
  protected readonly institutionSuggestOpen = signal(false);
  protected readonly institutionSuggestFormId = signal<string | null>(null);
  protected readonly institutionSuggestIndex = signal(-1);
  private institutionSuggestBlurTimer: ReturnType<typeof setTimeout> | null = null;

  /** Quick return by code — opens confirmation modal with customer extras. */
  protected readonly quickReturnToolId = signal<number | null>(null);
  protected readonly quickReturnCode = signal('');
  protected readonly quickReturnCharge = signal('');
  protected readonly quickReturnCodeOpen = signal(false);
  protected readonly quickReturnSearching = signal(false);
  protected readonly quickReturnSaving = signal(false);
  protected readonly quickReturnSession = signal<QuickReturnSession | null>(null);
  /** Inline charge amounts keyed by loan item id (local only). */
  protected readonly rowCharges = signal<Record<number, string>>({});

  protected readonly quickReturnCodes = computed(() => {
    const toolId = this.quickReturnToolId();
    if (toolId == null) {
      return [] as string[];
    }

    const codes = new Set<string>();
    for (const loan of this.activeLoans()) {
      for (const item of loan.items) {
        if (item.returnedAt || item.toolDefinitionId !== toolId) {
          continue;
        }
        const trimmed = item.serialCode.trim();
        if (trimmed) {
          codes.add(trimmed);
        }
      }
    }

    if (codes.size === 0) {
      const def = this.definitions().find((d) => d.id === toolId);
      for (const code of def?.serialCodes ?? []) {
        const trimmed = code.trim();
        if (trimmed) {
          codes.add(trimmed);
        }
      }
    }

    const query = this.quickReturnCode().trim().toLowerCase();
    const list = sortNumericCodes([...codes]);
    if (!query) {
      return list;
    }
    return list.filter((code) => code.toLowerCase().includes(query));
  });

  protected readonly timeLimitForm = this.fb.group({
    hours: [2, [Validators.required, Validators.min(0.25), Validators.max(168)]]
  });

  protected readonly forms = signal<LendingDraftForm[]>([this.createDraftForm()]);
  protected readonly formMinimized = signal(false);
  /** When set, the inline form updates an existing tools loan instead of creating one. */
  protected readonly editingLoanId = signal<number | null>(null);
  protected readonly deletingId = signal<number | null>(null);
  protected readonly deleteConfirmLoan = signal<{
    loanId: number;
    source: 'tools' | 'accessory';
    customerName: string;
    phone: string;
  } | null>(null);

  protected readonly showDeadline = computed(() => this.timeLimitEnabled());

  constructor() {
    effect(() => {
      this.orderDraft.resumeTick();
      untracked(() => this.tryRestoreMinimizedDraft());
    });
  }

  /** Local filter for the active-loans table — never triggers HTTP. */
  protected readonly activeSearchInput = this.fb.nonNullable.control('');
  protected readonly activeSearchQuery = signal('');

  protected readonly activeRows = computed(() => {
    this.nowTick();
    // Recompute accessory labels once the inventory catalog loads.
    this.inventoryStore.definitions();
    const sorted = [
      ...this.buildActiveLoanRowViews(this.activeLoans()),
      ...this.buildActiveAccessoryLoanRowViews(this.activeAccessoryLoans())
    ].sort((a, b) => b.lentAt.getTime() - a.lentAt.getTime());
    const raw = this.activeSearchQuery().trim().toLowerCase();
    if (!raw) {
      return sorted;
    }
    const needleDigits = raw.replace(/\D/g, '');
    const needleText = raw.replace(/-/g, '').replace(/\s/g, '');
    return sorted.filter((row) => {
      const name = (row.clientName ?? '').toLowerCase().replace(/-/g, '').replace(/\s/g, '');
      const phoneDigits = (row.phone ?? '').replace(/\D/g, '');
      const nameHit = name.includes(needleText);
      const phoneHit = needleDigits.length > 0 && phoneDigits.includes(needleDigits);
      const toolNameHit = (row.item.toolName ?? '').toLowerCase().includes(raw);
      const serialHit = (row.item.serialCode ?? '').toLowerCase().includes(raw) ||
        (row.activeSerialCodes ?? []).some((c) => c.toLowerCase().includes(raw));
      return nameHit || phoneHit || toolNameHit || serialHit;
    });
  });

  protected readonly activeCustomerCards = computed(() => {
    this.customers.customers();
    return this.buildActiveLoanCustomerCards(this.activeRows());
  });

  ngOnInit(): void {
    this.readRenewQueryParams();
    this.loadDefinitions();
    this.inventoryStore.load().subscribe();
    this.customers.load().subscribe();
    this.wireTimeLimitHours();
    this.wireCustomerSuggestDebounce();
    this.wireCustomerRiskAlertLookup();
    this.refreshActiveLoans();
    this.refreshAccessoryLoans();
    this.ordersSync.orderChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshAccessoryLoans());
    this.ordersSync.loanChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refreshActiveLoans());
    merge(
      this.ordersSync.debtChanged$,
      this.ordersSync.unreturnedChanged$,
      this.ordersSync.lostEquipmentChanged$
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        for (const form of this.forms()) {
          this.queueCustomerRiskLookup(form.id);
        }
      });
    if (this.orderDraft.draft()?.kind === 'tools-loan' && this.orderDraft.showBar()) {
      this.formMinimized.set(true);
    }
    this.tryRestoreMinimizedDraft();
    interval(60_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.nowTick.set(Date.now()));

    startLiveDataRefresh(
      this.destroyRef,
      () => {
        this.refreshActiveLoans();
        this.refreshAccessoryLoans();
        for (const form of this.forms()) {
          this.queueCustomerRiskLookup(form.id);
        }
      },
      {
        skipWhen: () =>
          this.submittingId() != null ||
          this.returningItemId() != null ||
          this.returningAccessoryKey() != null ||
          this.returningCustomerKey() != null ||
          this.deletingId() != null ||
          this.quickReturnSaving() ||
          this.quickReturnSession() != null
      }
    );
  }

  protected closeFormPanel(): void {
    if (this.submittingId()) {
      return;
    }
    this.editingLoanId.set(null);
    this.orderDraft.clearIfKind('tools-loan');
    this.formMinimized.set(false);
    this.forms.set([this.createDraftForm()]);
    this.closeToolUi();
    this.closeCustomerSuggest();
    this.closeInstitutionSuggest();
  }

  /** Keep the in-progress loan form while using another area of the app. */
  protected minimizeDraft(): void {
    if (this.submittingId()) {
      return;
    }

    const current = this.forms();
    const clientName = current[0]?.clientName?.trim() ?? '';
    this.orderDraft.minimize({
      kind: 'tools-loan',
      customerLabel: clientName,
      resumePath: '/tools/lending',
      payload: {
        formsJson: JSON.stringify(current, (_key, value) =>
          value instanceof Date ? value.toISOString() : value
        ),
        timeLimitEnabled: this.timeLimitEnabled(),
        timeLimitValue: Number(this.timeLimitForm.controls.hours.value) || 2
      }
    });
    this.closeToolUi();
    this.closeCustomerSuggest();
    this.closeInstitutionSuggest();
    this.formMinimized.set(true);
  }

  private tryRestoreMinimizedDraft(): void {
    const payload = this.orderDraft.takePendingRestore<WorkspaceLendingDraftPayload>('tools-loan');
    if (!payload) {
      return;
    }
    try {
      const parsed = JSON.parse(payload.formsJson) as Array<Record<string, unknown>>;
      const revived: LendingDraftForm[] = parsed.map((raw) => ({
        id: String(raw['id'] ?? `draft-${Date.now()}`),
        createdAt: new Date(String(raw['createdAt'] ?? Date.now())),
        hebrewDateTime: String(raw['hebrewDateTime'] ?? ''),
        toolLines: Array.isArray(raw['toolLines'])
          ? (raw['toolLines'] as ToolLineItem[]).map((line) => ({
              ...line,
              isTemporary: line.isTemporary === true,
              toolSuggestOpen: false,
              codesOpen: false
            }))
          : [this.createToolLine()],
        clientName: String(raw['clientName'] ?? ''),
        phone: String(raw['phone'] ?? ''),
        phone2: String(raw['phone2'] ?? ''),
        address: String(raw['address'] ?? ''),
        institutionName: String(raw['institutionName'] ?? ''),
        institutionId: typeof raw['institutionId'] === 'number' ? raw['institutionId'] : null,
        deposit: String(raw['deposit'] ?? ''),
        notes: String(raw['notes'] ?? ''),
        clientAlertNotes:
          typeof raw['clientAlertNotes'] === 'string' ? raw['clientAlertNotes'] : null,
        clientRiskAlerts: EMPTY_CUSTOMER_RISK_ALERTS,
        deadlineAt: raw['deadlineAt'] ? new Date(String(raw['deadlineAt'])) : null
      }));
      this.timeLimitEnabled.set(payload.timeLimitEnabled === true);
      this.timeLimitForm.controls.hours.setValue(payload.timeLimitValue || 2, { emitEvent: false });
      this.forms.set(revived.length > 0 ? revived : [this.createDraftForm()]);
      for (const form of this.forms()) {
        this.queueCustomerRiskLookup(form.id);
      }
      this.formMinimized.set(false);
    } catch {
      this.toast.error('לא ניתן לשחזר את טיוטת ההשאלה');
    }
  }

  protected onQuickReturnToolChange(toolId: number | null): void {
    this.quickReturnToolId.set(toolId != null && toolId > 0 ? toolId : null);
    this.quickReturnCode.set('');
    this.quickReturnCodeOpen.set(false);
  }

  protected onQuickReturnCodeInput(value: string): void {
    this.quickReturnCode.set(value);
    if (this.quickReturnToolId() != null) {
      this.quickReturnCodeOpen.set(true);
    }
  }

  protected onQuickReturnCodeFocus(): void {
    if (this.quickReturnToolId() != null) {
      this.quickReturnCodeOpen.set(true);
    }
  }

  protected onQuickReturnCodeBlur(): void {
    setTimeout(() => this.quickReturnCodeOpen.set(false), 150);
  }

  protected onQuickReturnChargeInput(value: string): void {
    this.quickReturnCharge.set(value);
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
    const options = this.quickReturnCodes();
    const typed = this.quickReturnCode().trim();
    if (options.length === 1 && typed && options[0].toLowerCase() !== typed.toLowerCase()) {
      this.selectQuickReturnCode(options[0]);
    }
    this.searchQuickReturn();
  }

  protected selectQuickReturnCode(code: string, event?: Event): void {
    event?.preventDefault();
    this.quickReturnCode.set(code);
    this.quickReturnCodeOpen.set(false);
  }

  protected onRowChargeInput(itemId: number, value: string): void {
    this.rowCharges.update((m) => ({ ...m, [itemId]: value }));
  }

  protected rowChargeValue(itemId: number): string {
    return this.rowCharges()[itemId] ?? '';
  }

  private parseCharge(raw: string | undefined | null): number | null {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) {
      return null;
    }
    const n = Number(trimmed.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) {
      return null;
    }
    return n;
  }

  protected searchQuickReturn(): void {
    if (this.quickReturnSearching() || this.quickReturnSaving()) {
      return;
    }

    const toolId = this.quickReturnToolId();
    if (toolId == null) {
      this.toast.warning('יש לבחור סוג כלי');
      return;
    }

    const serial = this.quickReturnCode().trim();
    if (!serial) {
      this.toast.warning('יש לבחור או להזין קוד פריט');
      return;
    }

    const openFromRows = (): void => {
      const allRows = this.buildActiveLoanRowViews(this.activeLoans());
      const matches = allRows.filter(
        (r) =>
          r.item.toolDefinitionId === toolId &&
          r.item.serialCode.localeCompare(serial, undefined, { sensitivity: 'accent' }) === 0
      );

      if (matches.length === 0) {
        this.toast.warning(`לא נמצאה השאלה פעילה עם קוד "${serial}"`);
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
      const customerRows = allRows.filter(
        (row) => this.normalizePhone(row.phone) === phoneKey && phoneKey.length > 0
      );
      const items = this.buildQuickReturnItems(
        customerRows.length > 0 ? customerRows : [match],
        match,
        serial
      );

      this.quickReturnSession.set({
        scannedCode: serial,
        customerName: match.clientName,
        phone: match.phone,
        address: match.address,
        items
      });
      this.quickReturnCodeOpen.set(false);
    };

    this.quickReturnSearching.set(true);
    this.data
      .getActiveToolLoans()
      .pipe(finalize(() => this.quickReturnSearching.set(false)))
      .subscribe((list) => {
        this.activeLoans.set(list);
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

  protected quickReturnAdditionalGroups(session: QuickReturnSession): QuickReturnLoanGroup[] {
    const extras = session.items.filter((item) => !item.isScannedMatch);
    const byDate = new Map<string, QuickReturnLoanGroup>();

    for (const item of extras) {
      const dateKey = item.loanDateIso || '';
      let group = byDate.get(dateKey);
      if (!group) {
        group = {
          dateKey,
          loanDateIso: item.loanDateIso,
          hebrewDate: item.hebrewDate || 'ללא תאריך',
          items: []
        };
        byDate.set(dateKey, group);
      }
      group.items.push(item);
    }

    return [...byDate.values()].sort((a, b) =>
      (b.loanDateIso || '').localeCompare(a.loanDateIso || '')
    );
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
          if (item.isScannedMatch && !checked) {
            return item;
          }
          return { ...item, selected: checked };
        })
      };
    });
  }

  protected selectQuickReturnGroup(dateKey: string, selected = true): void {
    this.quickReturnSession.update((session) => {
      if (!session) {
        return session;
      }
      return {
        ...session,
        items: session.items.map((item) => {
          if (item.isScannedMatch || (item.loanDateIso || '') !== dateKey) {
            return item;
          }
          return { ...item, selected };
        })
      };
    });
  }

  protected isQuickReturnGroupFullySelected(group: QuickReturnLoanGroup): boolean {
    return group.items.length > 0 && group.items.every((item) => item.selected);
  }

  protected confirmQuickReturn(): void {
    const session = this.quickReturnSession();
    if (!session || this.quickReturnSaving()) {
      return;
    }

    const selected = session.items.filter((item) => item.selected);
    if (selected.length === 0) {
      this.toast.warning('יש לבחור לפחות פריט אחד להחזרה');
      return;
    }

    const hebrew = this.formatHebrewDateTime(new Date(), true);
    const barCharge = this.parseCharge(this.quickReturnCharge());

    const requests = selected.map((item) => {
      const charge =
        item.isScannedMatch
          ? barCharge ?? this.parseCharge(this.rowChargeValue(item.itemId))
          : this.parseCharge(this.rowChargeValue(item.itemId));
      return this.data.returnToolLoanItem(item.loanId, item.itemId, {
        hebrewReturnedDisplay: hebrew,
        chargeAmount: charge && charge > 0 ? charge : null
      });
    });

    this.quickReturnSaving.set(true);
    forkJoin(requests)
      .pipe(finalize(() => this.quickReturnSaving.set(false)))
      .subscribe((results) => {
        const okCount = results.filter((r) => !!r).length;
        if (okCount === 0) {
          this.refreshActiveLoans();
          return;
        }
        this.toast.success(
          selected.length === 1
            ? 'הקוד הוחזר בהצלחה'
            : `${okCount} קודים הוחזרו בהצלחה`
        );
        this.rowCharges.update((m) => {
          const next = { ...m };
          for (const item of selected) {
            delete next[item.itemId];
          }
          return next;
        });
        this.quickReturnSession.set(null);
        this.quickReturnCode.set('');
        this.quickReturnCharge.set('');
        this.ordersSync.notifyLoanChanged();
        this.refreshActiveLoans();
        this.refreshAvailability();
        queueMicrotask(() => this.focusQuickReturnCodeInput());
      });
  }

  private buildActiveLoanRowViews(loans: ToolLoanDto[]): ActiveLoanRowView[] {
    const views: ActiveLoanRowView[] = [];
    for (const loan of loans) {
      const lentAt = this.parseLoanDate(loan.lentAt) ?? new Date();
      const deadlineAt = this.parseLoanDate(loan.deadlineAt);
      for (const item of loan.items ?? []) {
        if (item.returnedAt) {
          continue;
        }
        const serial = (item.serialCode ?? '').trim();
        views.push({
          rowKey: `${loan.id}-${item.id}`,
          loanId: loan.id,
          itemId: item.id,
          loanedEquipmentId: null,
          item: {
            ...item,
            toolName: item.toolName ?? '',
            serialCode: serial
          },
          source: 'tools',
          activeSerialCodes: [],
          quantity: 1,
          quantityLoaned: 1,
          clientName: loan.clientName ?? '',
          phone: loan.phone ?? '',
          address: (loan.address ?? '').trim(),
          lentAt,
          hebrewLentDisplay:
            (loan.hebrewLentDisplay ?? '').trim() || this.hebrew.formatHebrewDateTime(lentAt),
          deadlineAt,
          returning: this.returningItemId() === item.id,
          deposit: (loan.deposit ?? '').trim() || null,
          loanNotes: (loan.notes ?? '').trim() || null
        });
      }
    }
    return views.sort((a, b) => b.lentAt.getTime() - a.lentAt.getTime());
  }

  /** Maps only standalone accessory orders into the shared Tools-loans list. */
  private buildActiveAccessoryLoanRowViews(orders: OrderDto[]): ActiveLoanRowView[] {
    const views: ActiveLoanRowView[] = [];
    for (const order of orders) {
      if (
        order.isCancelled ||
        order.isReturnProcessed ||
        (order.equipmentDefinitionIds?.length ?? 0) > 0
      ) {
        continue;
      }
      const loanDate = order.shifts?.[0]?.orderDate ?? '';
      const lentAt = this.parseLoanDate(loanDate ? `${loanDate}T00:00:00` : null) ?? new Date(0);
      for (const line of order.loanedEquipments ?? []) {
        const quantity = line.quantity - (line.returnedQuantity ?? 0);
        if (quantity <= 0) {
          continue;
        }
        const serialCodes = (line.notes ?? [])
          .filter((note) => !note.isReturned)
          .map((note) => (note.content ?? '').trim())
          .filter((code) => code.length > 0);
        const label = this.inventoryStore.displayLabelForLoanedLine(line);
        views.push({
          rowKey: `accessory-${order.id}-${line.id ?? label}`,
          loanId: order.id,
          itemId: null,
          loanedEquipmentId: line.id ?? null,
          item: {
            id: line.id ?? -1,
            toolDefinitionId: -1,
            toolName: label,
            serialCode: serialCodes.join(', ')
          },
          source: 'accessory',
          activeSerialCodes: serialCodes,
          quantity,
          quantityLoaned: line.quantity,
          clientName: order.customerName ?? '',
          phone: order.phone ?? '',
          address: order.address ?? '',
          lentAt,
          hebrewLentDisplay: loanDate ? this.hebrew.toHebrewWithDayOfWeek(lentAt) : '—',
          deadlineAt: null,
          returning: false,
          deposit: this.formatOrderDeposit(order),
          loanNotes: (order.notes ?? '').trim() || null
        });
      }
    }
    return views;
  }

  private formatOrderDeposit(order: OrderDto): string | null {
    const typeLabel =
      order.depositType != null
        ? DEPOSIT_TYPE_LABELS[order.depositType as DepositType] ?? null
        : null;
    const onName = (order.depositOnName ?? '').trim() || null;
    if (!typeLabel && !onName) {
      return null;
    }
    if (!typeLabel) {
      return onName;
    }
    return onName ? `${typeLabel} — ${onName}` : typeLabel;
  }

  private buildQuickReturnItems(
    customerRows: ActiveLoanRowView[],
    match: ActiveLoanRowView,
    scannedCode: string
  ): QuickReturnItem[] {
    const items: QuickReturnItem[] = [];

    for (const row of customerRows) {
      if (row.source !== 'tools' || row.itemId == null) {
        continue;
      }
      const isScannedMatch =
        row.rowKey === match.rowKey &&
        row.item.serialCode.localeCompare(scannedCode, undefined, { sensitivity: 'accent' }) === 0;
      const hebrewDate = this.hebrew.toHebrew(row.lentAt);
      items.push({
        key: row.rowKey,
        loanId: row.loanId,
        itemId: row.itemId,
        toolDefinitionId: row.item.toolDefinitionId,
        toolName: row.item.toolName,
        serialCode: row.item.serialCode,
        loanDateIso: this.toIsoDate(row.lentAt),
        hebrewDate,
        selected: isScannedMatch,
        isScannedMatch
      });
    }

    items.sort((a, b) => Number(b.isScannedMatch) - Number(a.isScannedMatch));
    return items;
  }

  private normalizePhone(phone: string | null | undefined): string {
    return (phone ?? '').replace(/\D/g, '');
  }

  private toIsoDate(date: Date | null | undefined): string {
    if (!date || Number.isNaN(date.getTime())) {
      return '';
    }
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** Parse API / legacy date strings; returns null when missing or invalid. */
  private parseLoanDate(value: string | Date | null | undefined): Date | null {
    if (value == null || value === '') {
      return null;
    }
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private focusQuickReturnCodeInput(): void {
    const input = this.document.getElementById(
      'tools-quick-return-code-input'
    ) as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }

  protected refreshActiveLoans(): void {
    this.activeLoading.set(true);
    this.refreshAccessoryLoans();
    this.data
      .getActiveToolLoans()
      .pipe(finalize(() => this.activeLoading.set(false)))
      .subscribe((list) => {
        this.activeLoans.set(list);
      });
  }

  protected refreshAccessoryLoans(): void {
    this.data
      .getQuickLoans()
      .subscribe((orders) =>
        this.activeAccessoryLoans.set(
          orders.filter((order) => (order.equipmentDefinitionIds?.length ?? 0) === 0)
        )
      );
  }

  protected isAccessoryLoan(row: ActiveLoanRowView): boolean {
    return row.source === 'accessory';
  }

  protected formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
  }

  protected durationText(row: ActiveLoanRowView): string {
    // Same calendar-day span as the returns module / loan-range calendar
    // (loan start → now for still-held items).
    return formatCalendarDuration(row.lentAt, new Date(this.nowTick()));
  }

  protected isOverdue(row: ActiveLoanRowView): boolean {
    if (!row.deadlineAt || Number.isNaN(row.deadlineAt.getTime())) {
      return false;
    }
    return new Date(this.nowTick()).getTime() > row.deadlineAt.getTime();
  }

  protected onReturnedToggle(row: ActiveLoanRowView, checked: boolean): void {
    if (!checked) {
      return;
    }
    if (
      this.returningCustomerKey() != null ||
      this.returningItemId() != null ||
      this.returningAccessoryKey() != null
    ) {
      return;
    }

    if (row.source === 'accessory') {
      this.returnAccessoryLoanRow(row);
      return;
    }
    if (row.itemId == null) {
      return;
    }

    const stamp = new Date();
    const hebrew = this.formatHebrewDateTime(stamp, true);
    const itemId = row.itemId;
    const charge = this.parseCharge(this.rowChargeValue(itemId));
    this.returningItemId.set(itemId);

    this.data
      .returnToolLoanItem(row.loanId, itemId, {
        hebrewReturnedDisplay: hebrew,
        chargeAmount: charge && charge > 0 ? charge : null
      })
      .pipe(finalize(() => this.returningItemId.set(null)))
      .subscribe((updated) => {
        if (!updated) {
          this.refreshActiveLoans();
          return;
        }
        this.toast.success('ההחזרה נרשמה');
        this.rowCharges.update((m) => {
          const next = { ...m };
          delete next[itemId];
          return next;
        });
        this.ordersSync.notifyLoanChanged();
        this.refreshActiveLoans();
        this.refreshAvailability();
      });
  }

  /**
   * Returns an accessory through the same Orders endpoint used by Sound Active
   * Loans and Accessory Returns, then broadcasts the updated order to every view.
   */
  private returnAccessoryLoanRow(row: ActiveLoanRowView): void {
    if (row.loanedEquipmentId == null) {
      return;
    }

    const request = {
      items: [
        this.toAccessoryReturnItem(row as ActiveLoanRowView & { loanedEquipmentId: number })
      ]
    };

    this.returningAccessoryKey.set(row.rowKey);
    this.data
      .recordOrderReturn(row.loanId, request)
      .pipe(finalize(() => this.returningAccessoryKey.set(null)))
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.ordersSync.notifyOrderUpdated(updated);
        this.ordersSync.notifyLoanChanged();
        this.toast.success('הפריט סומן כהוחזר');
        this.refreshAccessoryLoans();
        this.refreshAvailability();
      });
  }

  protected isReturningCustomer(card: ActiveLoanCustomerCard): boolean {
    return this.returningCustomerKey() === card.key;
  }

  protected isCardBusy(card: ActiveLoanCustomerCard): boolean {
    if (this.isReturningCustomer(card)) {
      return true;
    }
    const itemId = this.returningItemId();
    if (itemId != null && card.items.some((row) => row.itemId === itemId)) {
      return true;
    }
    const accessoryKey = this.returningAccessoryKey();
    return accessoryKey != null && card.items.some((row) => row.rowKey === accessoryKey);
  }

  protected hasReturnableItems(card: ActiveLoanCustomerCard): boolean {
    return (card.items ?? []).some(
      (row) =>
        (row.source === 'tools' && row.itemId != null && row.itemId > 0) ||
        (row.source === 'accessory' && row.loanedEquipmentId != null && row.loanedEquipmentId > 0)
    );
  }

  protected cardTotalCharge(card: ActiveLoanCustomerCard): number {
    this.rowCharges();
    let sum = 0;
    for (const row of card.items) {
      if (row.source !== 'tools' || row.itemId == null) {
        continue;
      }
      const charge = this.parseCharge(this.rowChargeValue(row.itemId));
      if (charge != null) {
        sum += charge;
      }
    }
    return sum;
  }

  protected formatChargeTotal(amount: number): string {
    const rounded = Math.round(amount * 100) / 100;
    return Number.isInteger(rounded) ? `₪${rounded}` : `₪${rounded.toFixed(2)}`;
  }

  protected markCustomerAllReturned(card: ActiveLoanCustomerCard): void {
    const toolRows = (card.items ?? []).filter(
      (row): row is ActiveLoanRowView & { itemId: number } =>
        row.source === 'tools' && row.itemId != null && row.itemId > 0
    );
    const accessoryRows = (card.items ?? []).filter(
      (row): row is ActiveLoanRowView & { loanedEquipmentId: number } =>
        row.source === 'accessory' &&
        row.loanedEquipmentId != null &&
        row.loanedEquipmentId > 0
    );
    if (
      this.returningCustomerKey() != null ||
      this.returningItemId() != null ||
      this.returningAccessoryKey() != null ||
      (toolRows.length === 0 && accessoryRows.length === 0)
    ) {
      return;
    }

    const hebrew = this.formatHebrewDateTime(new Date(), true);
    const requests = toolRows.map((row) => {
      const charge = this.parseCharge(this.rowChargeValue(row.itemId));
      return this.data.returnToolLoanItem(row.loanId, row.itemId, {
        hebrewReturnedDisplay: hebrew,
        chargeAmount: charge && charge > 0 ? charge : null
      });
    });
    const accessoryRequests = accessoryRows.map((row) =>
      this.data.recordOrderReturn(row.loanId, {
        items: [this.toAccessoryReturnItem(row)]
      })
    );

    this.returningCustomerKey.set(card.key);
    forkJoin([...requests, ...accessoryRequests])
      .pipe(finalize(() => this.returningCustomerKey.set(null)))
      .subscribe((results) => {
        const okCount = results.filter((r) => !!r).length;
        if (okCount === 0) {
          this.refreshActiveLoans();
          return;
        }
        this.toast.success(
          card.items.length === 1
            ? 'הפריט סומן כהוחזר'
            : `${okCount} פריטים סומנו כהוחזרו`
        );
        this.rowCharges.update((m) => {
          const next = { ...m };
          for (const row of toolRows) {
            delete next[row.itemId];
          }
          return next;
        });
        for (const order of results.slice(toolRows.length)) {
          if (order) {
            // The slice contains only `recordOrderReturn` results (OrderDto);
            // TypeScript retains the union from the combined forkJoin array.
            this.ordersSync.notifyOrderUpdated(order as OrderDto);
          }
        }
        if (toolRows.length > 0 || accessoryRows.length > 0) {
          this.ordersSync.notifyLoanChanged();
        }
        this.refreshActiveLoans();
        this.refreshAvailability();
      });
  }

  private customerCardKey(row: Pick<ActiveLoanRowView, 'clientName' | 'phone'>): string {
    return `${(row.clientName ?? '').trim()}|${(row.phone ?? '').replace(/\D/g, '')}`;
  }

  private toAccessoryReturnItem(row: ActiveLoanRowView & { loanedEquipmentId: number }): {
    loanedEquipmentId: number;
    quantityReturned: number;
    returnedSerialCodes?: string[];
  } {
    const serials = (row.activeSerialCodes ?? []).map((c) => c.trim()).filter(Boolean);
    const serialized = serials.length > 0;
    const remaining = Math.max(row.quantity || 0, 1);
    return {
      loanedEquipmentId: row.loanedEquipmentId,
      quantityReturned: serialized ? serials.length : remaining,
      ...(serialized ? { returnedSerialCodes: [...serials] } : {})
    };
  }

  protected activeLoanDateLabel(date: Date): string {
    if (!date || Number.isNaN(date.getTime())) {
      return '—';
    }
    return this.hebrew.formatGregorianWithDayName(date);
  }

  protected activeLoanHebrewDate(date: Date): string {
    if (!date || Number.isNaN(date.getTime())) {
      return '';
    }
    return this.hebrew.toHebrewWithDayOfWeek(date);
  }

  protected activeLoanTimeLabel(date: Date | null | undefined): string {
    if (!date || Number.isNaN(date.getTime())) {
      return '—';
    }
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  private buildActiveLoanCustomerCards(rows: ActiveLoanRowView[]): ActiveLoanCustomerCard[] {
    const byCustomer = new Map<string, ActiveLoanCustomerCard>();

    for (const row of rows) {
      const key = `${this.customerCardKey(row)}|${this.toIsoDate(row.lentAt)}`;
      let card = byCustomer.get(key);
      if (!card) {
        card = {
          key,
          customerName: row.clientName,
          phone: row.phone,
          address: row.address,
          loanDate: row.lentAt,
          customerNotes: this.customers.notesForPhone(row.phone),
          deposit: row.deposit,
          loanNotes: row.loanNotes,
          items: []
        };
        byCustomer.set(key, card);
      }
      if (!card.address && row.address) {
        card.address = row.address;
      }
      if (!card.customerNotes) {
        card.customerNotes = this.customers.notesForPhone(row.phone);
      }
      if (!card.deposit && row.deposit) {
        card.deposit = row.deposit;
      }
      if (!card.loanNotes && row.loanNotes) {
        card.loanNotes = row.loanNotes;
      }
      card.items.push(row);
    }

    return [...byCustomer.values()].sort((a, b) => {
      const nameCmp = a.customerName.localeCompare(b.customerName, 'he');
      if (nameCmp !== 0) {
        return nameCmp;
      }
      const aTime = a.loanDate?.getTime?.() ?? 0;
      const bTime = b.loanDate?.getTime?.() ?? 0;
      const dateCmp = (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
      return dateCmp !== 0 ? dateCmp : a.phone.localeCompare(b.phone, 'he');
    });
  }

  /** Single loan/order on the card — same gate as accessory quick-loan edit/delete. */
  protected cardSoleLoan(
    card: ActiveLoanCustomerCard
  ): { loanId: number; source: 'tools' | 'accessory' } | null {
    if (card.items.length === 0) {
      return null;
    }
    const first = card.items[0];
    const same = card.items.every(
      (row) => row.loanId === first.loanId && row.source === first.source
    );
    return same ? { loanId: first.loanId, source: first.source } : null;
  }

  protected startEditCard(card: ActiveLoanCustomerCard): void {
    const sole = this.cardSoleLoan(card);
    if (!sole) {
      return;
    }

    if (sole.source === 'accessory') {
      void this.router.navigate(['/tools/accessory-lending'], {
        queryParams: { edit: sole.loanId }
      });
      return;
    }

    const loan = this.activeLoans().find((l) => l.id === sole.loanId);
    if (!loan) {
      this.toast.error('ההשאלה לא נמצאה');
      return;
    }

    this.deleteConfirmLoan.set(null);
    this.editingLoanId.set(loan.id);
    this.formMinimized.set(false);
    this.orderDraft.clearIfKind('tools-loan');
    this.closeToolUi();
    this.closeCustomerSuggest();
    this.closeInstitutionSuggest();

    const activeItems = (loan.items ?? []).filter((i) => !i.returnedAt);
    const linesByTool = new Map<number, ToolLineItem>();
    const toolLines: ToolLineItem[] = [];

    for (const item of activeItems) {
      const serial = (item.serialCode ?? '').trim();
      if (item.toolDefinitionId <= 0) {
        toolLines.push({
          id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          toolId: null,
          toolQuery: (item.toolName ?? '').trim(),
          selectedCodes: serial ? [serial] : [],
          isTemporary: true,
          toolSuggestOpen: false,
          codesOpen: false
        });
        continue;
      }

      const existing = linesByTool.get(item.toolDefinitionId);
      if (existing) {
        if (serial) {
          existing.selectedCodes = [...existing.selectedCodes, serial];
        }
        continue;
      }

      const def = this.definitions().find((d) => d.id === item.toolDefinitionId);
      const line: ToolLineItem = {
        id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        toolId: item.toolDefinitionId,
        toolQuery: def?.displayName ?? item.toolName ?? '',
        selectedCodes: serial ? [serial] : [],
        isTemporary: false,
        toolSuggestOpen: false,
        codesOpen: false
      };
      linesByTool.set(item.toolDefinitionId, line);
      toolLines.push(line);
    }

    const lentAt = this.parseLoanDate(loan.lentAt) ?? new Date();
    const deadlineAt = this.parseLoanDate(loan.deadlineAt);
    if (deadlineAt) {
      this.timeLimitEnabled.set(true);
    }

    const draft: LendingDraftForm = {
      id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: lentAt,
      hebrewDateTime:
        (loan.hebrewLentDisplay ?? '').trim() || this.formatHebrewDateTime(lentAt),
      toolLines: toolLines.length > 0 ? toolLines : [this.createToolLine()],
      clientName: loan.clientName ?? '',
      phone: loan.phone ?? '',
      phone2: loan.phone2 ?? '',
      address: loan.address ?? '',
      institutionName: loan.institutionName ?? '',
      institutionId: loan.institutionId ?? null,
      deposit: loan.deposit ?? '',
      notes: loan.notes ?? '',
      clientAlertNotes: null,
      clientRiskAlerts: EMPTY_CUSTOMER_RISK_ALERTS,
      deadlineAt
    };

    this.forms.set([draft]);
    this.lookupClientNotesByPhone(draft.id, draft.phone);
    this.queueCustomerRiskLookup(draft.id);
    queueMicrotask(() => {
      this.document.getElementById('tools-loan-form-title')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    });
  }

  protected cancelEdit(): void {
    this.editingLoanId.set(null);
    this.forms.set([this.createDraftForm()]);
    this.closeToolUi();
    this.closeCustomerSuggest();
    this.closeInstitutionSuggest();
  }

  protected askDeleteCard(card: ActiveLoanCustomerCard): void {
    const sole = this.cardSoleLoan(card);
    if (!sole) {
      return;
    }
    this.deleteConfirmLoan.set({
      loanId: sole.loanId,
      source: sole.source,
      customerName: card.customerName,
      phone: card.phone
    });
  }

  protected closeDeleteConfirm(): void {
    if (this.deletingId()) {
      return;
    }
    this.deleteConfirmLoan.set(null);
  }

  protected confirmDeleteLoan(): void {
    const doomed = this.deleteConfirmLoan();
    if (!doomed || this.deletingId()) {
      return;
    }

    this.deletingId.set(doomed.loanId);
    const request$ =
      doomed.source === 'accessory'
        ? this.data.deleteOrder(doomed.loanId)
        : this.data.deleteToolLoan(doomed.loanId);

    request$.pipe(finalize(() => this.deletingId.set(null))).subscribe((ok) => {
      if (!ok) {
        return;
      }
      this.toast.success(`השאלה #${doomed.loanId} נמחקה`);
      this.deleteConfirmLoan.set(null);
      if (this.editingLoanId() === doomed.loanId) {
        this.cancelEdit();
      }
      if (doomed.source === 'accessory') {
        this.ordersSync.notifyLoanChanged();
        this.refreshAccessoryLoans();
      } else {
        this.ordersSync.notifyLoanChanged();
        this.ordersSync.notifyDebtChanged();
        this.refreshActiveLoans();
        this.refreshAvailability();
      }
    });
  }

  protected removeForm(formId: string): void {
    this.forms.update((list) => (list.length <= 1 ? list : list.filter((f) => f.id !== formId)));
  }

  protected addToolLine(formId: string): void {
    this.forms.update((list) =>
      list.map((f) =>
        f.id !== formId
          ? f
          : { ...f, toolLines: [...f.toolLines, this.createToolLine()] }
      )
    );
  }

  protected removeToolLine(formId: string, lineId: string): void {
    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        const next = f.toolLines.filter((l) => l.id !== lineId);
        return { ...f, toolLines: next.length > 0 ? next : [this.createToolLine()] };
      })
    );
  }

  protected toggleTimeLimit(): void {
    const next = !this.timeLimitEnabled();
    this.timeLimitEnabled.set(next);
    if (next) {
      this.recomputeAllDeadlines();
    } else {
      this.forms.update((list) => list.map((f) => ({ ...f, deadlineAt: null })));
    }
  }

  protected filteredToolsForLine(form: LendingDraftForm, line: ToolLineItem): ToolDefinitionDto[] {
    const q = line.toolQuery.trim().toLowerCase();
    const usedElsewhere = new Set(
      form.toolLines
        .filter((l) => l.id !== line.id && l.toolId != null)
        .map((l) => l.toolId as number)
    );
    const base = this.definitions().filter((d) => {
      if (usedElsewhere.has(d.id) && d.id !== line.toolId) {
        return false;
      }
      if (!q) {
        return true;
      }
      return d.displayName.toLowerCase().includes(q);
    });

    if (!this.formHasHammerDrill(form)) {
      return base;
    }

    const hammerBits = matchingHammerDrillBitTools(this.definitions(), line.toolQuery).filter(
      (tool) => !usedElsewhere.has(tool.id) || tool.id === line.toolId
    );
    if (hammerBits.length === 0) {
      return base;
    }

    const hammerIds = new Set(hammerBits.map((tool) => tool.id));
    return [...hammerBits, ...base.filter((tool) => !hammerIds.has(tool.id))];
  }

  protected availableCodesForLine(_form: LendingDraftForm, line: ToolLineItem): string[] {
    if (line.toolId == null) {
      return [];
    }
    // Local filter only — from the single bulk cache loaded at page init.
    // When editing, keep codes already on this line selectable even if currently loaned out.
    const inStock = this.availableByTool().get(line.toolId) ?? [];
    const merged = new Set([...inStock, ...line.selectedCodes.map((c) => c.trim()).filter(Boolean)]);
    return sortNumericCodes([...merged]);
  }

  protected onToolQueryInput(formId: string, lineId: string, value: string): void {
    const form = this.forms().find((f) => f.id === formId);
    let toolQuery = value;
    let resolvedToolId: number | null = null;

    if (form && this.formHasHammerDrill(form)) {
      const autoComplete = shouldAutoCompleteHammerDrillBitName(value);
      if (autoComplete) {
        const tool = findHammerDrillBitTool(this.definitions(), autoComplete.size);
        if (tool) {
          toolQuery = tool.displayName;
          resolvedToolId = tool.id;
        }
      }
    }

    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        return {
          ...f,
          toolLines: f.toolLines.map((l) =>
            l.id !== lineId
              ? { ...l, toolSuggestOpen: false, codesOpen: false }
              : {
                  ...l,
                  toolQuery,
                  toolId: resolvedToolId,
                  selectedCodes: [],
                  isTemporary: false,
                  toolSuggestOpen: true,
                  codesOpen: false
                }
          )
        };
      })
    );
    this.closeCustomerSuggest();
  }

  protected onToolQueryFocus(formId: string, lineId: string): void {
    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        return {
          ...f,
          toolLines: f.toolLines.map((l) => ({
            ...l,
            toolSuggestOpen: l.id === lineId,
            codesOpen: false
          }))
        };
      })
    );
    this.closeCustomerSuggest();
  }

  protected onToolQueryEnter(formId: string, lineId: string, event: Event): void {
    console.log('[ToolsLending] Enter pressed on tool name', {
      action: 'Enter pressed on tool name',
      formId,
      lineId,
      event
    });
    event.preventDefault();
    event.stopPropagation();
    if (this.tryResolveHammerDrillBitShortcut(formId, lineId)) {
      return;
    }
    this.commitLineAndAddNext(formId, lineId);
  }

  protected onCodesEnter(formId: string, lineId: string, event: Event): void {
    console.log('[ToolsLending] Enter pressed on codes', {
      action: 'Enter pressed on codes',
      formId,
      lineId,
      event
    });
    event.preventDefault();
    event.stopPropagation();
    this.commitLineAndAddNext(formId, lineId);
  }

  protected onAddToolLineClick(formId: string, event: Event): void {
    const form = this.forms().find((f) => f.id === formId);
    const activeLineId = this.activeLineIdForForm(formId);
    const activeRowIndex =
      activeLineId && form ? form.toolLines.findIndex((l) => l.id === activeLineId) : -1;
    console.log('[ToolsLending] + button clicked', {
      action: '+ button clicked',
      formId,
      lineId: activeLineId,
      activeRowIndex,
      event
    });
    event.preventDefault();
    event.stopPropagation();
    if (activeLineId) {
      this.commitLineAndAddNext(formId, activeLineId);
      return;
    }
    // Graceful fallback: if nothing is focused, always append a fresh row to the end.
    this.addToolLine(formId);
  }

  protected selectTool(formId: string, lineId: string, tool: ToolDefinitionDto): void {
    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        return {
          ...f,
          toolLines: f.toolLines.map((l) =>
            l.id !== lineId
              ? l
              : {
                  ...l,
                  toolId: tool.id,
                  toolQuery: tool.displayName,
                  selectedCodes: [],
                  isTemporary: false,
                  toolSuggestOpen: false,
                  codesOpen: false
                }
          )
        };
      })
    );
    if (isHammerDrillBitDisplayName(tool.displayName)) {
      this.scheduleFocusCodesDropdown(formId, lineId);
    }
  }

  protected toggleCodesDropdown(formId: string, lineId: string, event: Event): void {
    event.stopPropagation();
    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        return {
          ...f,
          toolLines: f.toolLines.map((l) => ({
            ...l,
            codesOpen: l.id === lineId ? !l.codesOpen : false,
            toolSuggestOpen: false
          }))
        };
      })
    );
    this.closeCustomerSuggest();
  }

  protected toggleCodeSelection(formId: string, lineId: string, code: string, event: Event): void {
    event.stopPropagation();
    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        return {
          ...f,
          toolLines: f.toolLines.map((l) => {
            if (l.id !== lineId) {
              return l;
            }
            const selected = l.selectedCodes.includes(code)
              ? l.selectedCodes.filter((c) => c !== code)
              : [...l.selectedCodes, code];
            return { ...l, selectedCodes: selected };
          })
        };
      })
    );
  }

  protected patchForm(
    formId: string,
    patch: Partial<
      Pick<
        LendingDraftForm,
        | 'clientName'
        | 'phone'
        | 'phone2'
        | 'address'
        | 'institutionName'
        | 'institutionId'
        | 'deposit'
        | 'notes'
        | 'clientAlertNotes'
        | 'clientRiskAlerts'
      >
    >
  ): void {
    this.forms.update((list) => list.map((f) => (f.id === formId ? { ...f, ...patch } : f)));
  }

  protected onClientNameInput(formId: string, value: string): void {
    this.patchForm(formId, {
      clientName: value,
      clientAlertNotes: null,
      clientRiskAlerts: EMPTY_CUSTOMER_RISK_ALERTS
    });
    this.openCustomerSuggest(formId, 'name', value);
    this.queueCustomerRiskLookup(formId);
  }

  protected onPhoneInput(formId: string, value: string): void {
    const digits = clampIsraeliPhoneDigits(value);
    this.patchForm(formId, {
      phone: digits,
      clientAlertNotes: null,
      clientRiskAlerts: EMPTY_CUSTOMER_RISK_ALERTS
    });
    this.openCustomerSuggest(formId, 'phone', digits);
    if (digits.length >= 9) {
      this.lookupClientNotesByPhone(formId, digits);
    }
    this.queueCustomerRiskLookup(formId);
  }

  protected onPhone2Input(formId: string, value: string): void {
    const digits = clampIsraeliPhoneDigits(value);
    this.patchForm(formId, { phone2: digits });
  }

  protected onAddressInput(formId: string, value: string): void {
    this.patchForm(formId, { address: value });
  }

  protected onInstitutionInput(formId: string, value: string): void {
    const form = this.forms().find((f) => f.id === formId);
    const currentId = form?.institutionId ?? null;
    let nextId: number | null = currentId;
    if (currentId != null) {
      const selected = this.institutionSuggestions().find((i) => i.id === currentId);
      if (!selected || selected.name !== value.trim()) {
        nextId = null;
      }
    }
    this.patchForm(formId, { institutionName: value, institutionId: nextId });
    this.closeCustomerSuggest();
    this.institutionSuggestFormId.set(formId);
    const q = value.trim();
    if (q.length === 0) {
      this.institutionSuggestions.set([]);
      this.institutionSuggestOpen.set(false);
      this.institutionSuggestIndex.set(-1);
      return;
    }
    this.data.searchInstitutions(q).subscribe((list) => {
      if (this.institutionSuggestFormId() !== formId) {
        return;
      }
      this.institutionSuggestions.set(list);
      this.institutionSuggestIndex.set(list.length > 0 ? 0 : -1);
      this.institutionSuggestOpen.set(list.length > 0);
    });
  }

  protected onInstitutionFocus(formId: string): void {
    if (this.institutionSuggestBlurTimer) {
      clearTimeout(this.institutionSuggestBlurTimer);
      this.institutionSuggestBlurTimer = null;
    }
    this.institutionSuggestFormId.set(formId);
    const form = this.forms().find((f) => f.id === formId);
    const q = (form?.institutionName ?? '').trim();
    if (q.length > 0 && this.institutionSuggestions().length > 0) {
      this.institutionSuggestOpen.set(true);
    } else if (q.length > 0) {
      this.onInstitutionInput(formId, form?.institutionName ?? '');
    }
  }

  protected onInstitutionBlur(): void {
    this.institutionSuggestBlurTimer = setTimeout(() => {
      this.closeInstitutionSuggest();
    }, 150);
  }

  protected onInstitutionKeydown(formId: string, event: KeyboardEvent): void {
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
        this.selectInstitutionSuggestion(formId, pick);
      }
    } else if (event.key === 'Escape') {
      this.closeInstitutionSuggest();
    }
  }

  protected selectInstitutionSuggestion(
    formId: string,
    inst: InstitutionDto,
    event?: Event
  ): void {
    event?.preventDefault();
    this.patchForm(formId, {
      institutionName: inst.name,
      institutionId: inst.id
    });
    this.closeInstitutionSuggest();
  }

  protected closeInstitutionSuggest(): void {
    this.institutionSuggestOpen.set(false);
    this.institutionSuggestFormId.set(null);
    this.institutionSuggestIndex.set(-1);
  }

  protected selectCustomerSuggestion(formId: string, customer: CustomerSuggestDto): void {
    this.patchForm(formId, {
      clientName: customer.fullName ?? '',
      phone: customer.phone1,
      phone2: customer.phone2 ?? '',
      address: customer.address ?? '',
      clientRiskAlerts: EMPTY_CUSTOMER_RISK_ALERTS
    });
    this.closeCustomerSuggest();
    this.lookupClientNotesByPhone(formId, customer.phone1);
    this.queueCustomerRiskLookup(formId);
  }

  protected dismissClientAlert(formId: string): void {
    this.patchForm(formId, { clientAlertNotes: null });
  }

  protected closeCustomerSuggest(): void {
    this.customerSuggestOpen.set(false);
    this.customerSuggestField.set(null);
    this.customerSuggestFormId.set(null);
  }

  protected formatDeadline(deadline: Date | null | undefined): string {
    if (!deadline || Number.isNaN(deadline.getTime())) {
      return '—';
    }
    const hh = String(deadline.getHours()).padStart(2, '0');
    const mm = String(deadline.getMinutes()).padStart(2, '0');
    return `${this.hebrew.toHebrew(deadline)} ${hh}:${mm}`;
  }

  protected submitForm(form: LendingDraftForm): void {
    const items = this.buildLoanItems(form);
    if (!items) {
      return;
    }
    if (!form.phone.trim()) {
      this.toast.error('יש להזין מספר טלפון');
      return;
    }
    if (!isValidIsraeliPhone(form.phone.trim())) {
      this.toast.error(ISRAELI_PHONE_INVALID_MESSAGE);
      return;
    }
    if (form.phone2.trim() && !isValidIsraeliPhone(form.phone2.trim())) {
      this.toast.error(ISRAELI_PHONE_INVALID_MESSAGE);
      return;
    }

    const payload: ToolLoanCreateDto = {
      clientName: form.clientName.trim(),
      phone: form.phone.trim(),
      phone2: form.phone2.trim() || null,
      address: form.address.trim() || null,
      institutionName: form.institutionName.trim() || null,
      institutionId: form.institutionId,
      deposit: form.deposit.trim() || null,
      notes: form.notes.trim() || null,
      hebrewLentDisplay: form.hebrewDateTime,
      deadlineAt: this.timeLimitEnabled() && form.deadlineAt ? form.deadlineAt.toISOString() : null,
      items
    };

    this.submittingId.set(form.id);
    const editingId = this.editingLoanId();
    const request$ =
      editingId != null
        ? this.data.updateToolLoan(editingId, payload)
        : this.data.createToolLoan(payload);
    request$
      .pipe(finalize(() => this.submittingId.set(null)))
      .subscribe((saved) => {
        if (!saved) {
          return;
        }
        const address = form.address.trim() || null;
        const phone2 = form.phone2.trim() || null;
        this.customers.upsertFromPayload({
          phone1: payload.phone,
          phone2,
          fullName: payload.clientName || null,
          address,
          systemType: SystemType.Tools
        });
        this.data
          .upsertCustomer({
            phone1: payload.phone,
            phone2,
            fullName: payload.clientName || null,
            address,
            systemType: SystemType.Tools
          })
          .subscribe((customer) => {
            if (customer) {
              this.customers.upsert(customer);
            }
          });
        this.toast.success(
          editingId != null ? `השאלה #${saved.id} עודכנה` : 'ההשאלה נשמרה'
        );
        this.editingLoanId.set(null);
        this.orderDraft.clearIfKind('tools-loan');
        this.formMinimized.set(false);
        this.forms.set([this.createDraftForm()]);
        this.ordersSync.notifyLoanChanged();
        this.refreshAvailability();
        this.refreshActiveLoans();
      });
  }

  private applyClientNotesAlert(formId: string, notes: string | null | undefined): void {
    const trimmed = (notes ?? '').trim();
    if (!trimmed) {
      this.patchForm(formId, { clientAlertNotes: null });
      return;
    }
    this.patchForm(formId, { clientAlertNotes: trimmed });
    this.toast.error(`התראת לקוח: ${trimmed}`);
  }

  private lookupClientNotesByPhone(formId: string, phone: string): void {
    this.customers.searchGlobal(phone).subscribe((hits) => {
      const match = hits.find((c) => c.phone1 === phone);
      if (match) {
        this.applyClientNotesAlert(formId, match.notes);
      }
    });
  }

  private queueCustomerRiskLookup(formId: string): void {
    const form = this.forms().find((f) => f.id === formId);
    if (!form) {
      return;
    }
    this.customerRiskLookup$.next({
      formId,
      phone: digitsOnlyPhone(form.phone),
      customerName: form.clientName.trim()
    });
  }

  private wireCustomerRiskAlertLookup(): void {
    this.customerRiskLookup$
      .pipe(
        groupBy((req) => req.formId),
        mergeMap((perForm$) =>
          perForm$.pipe(
            debounceTime(350),
            distinctUntilChanged(
              (a, b) => a.phone === b.phone && a.customerName === b.customerName
            ),
            switchMap(({ formId, phone, customerName }) => {
              if (phone.length < 7 && customerName.length < 2) {
                this.patchForm(formId, { clientRiskAlerts: EMPTY_CUSTOMER_RISK_ALERTS });
                return EMPTY;
              }
              return forkJoin({
                cancelled: this.data.getCancelledOrdersReport(),
                openDebts: this.data.getOpenDebtGroupsReport(),
                unreturned: this.data.getUnreturnedItems()
              }).pipe(
                map(({ cancelled, openDebts, unreturned }) => ({
                  formId,
                  snapshot: buildCustomerRiskAlertSnapshot(
                    cancelled,
                    openDebts,
                    unreturned.map((row) => this.inventoryStore.enrichUnreturnedItem(row)),
                    phone,
                    customerName
                  )
                }))
              );
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ formId, snapshot }) => {
        this.patchForm(formId, { clientRiskAlerts: snapshot });
      });
  }

  private closeToolUi(): void {
    this.forms.update((list) =>
      list.map((f) => ({
        ...f,
        toolLines: f.toolLines.map((l) => ({
          ...l,
          toolSuggestOpen: false,
          codesOpen: false
        }))
      }))
    );
  }

  protected closeToolSuggest(formId: string, lineId: string): void {
    this.patchToolLineUi(formId, lineId, { toolSuggestOpen: false });
  }

  protected closeCodesDropdown(formId: string, lineId: string): void {
    this.patchToolLineUi(formId, lineId, { codesOpen: false });
  }

  private patchToolLineUi(
    formId: string,
    lineId: string,
    patch: Pick<ToolLineItem, 'toolSuggestOpen'> | Pick<ToolLineItem, 'codesOpen'>
  ): void {
    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        return {
          ...f,
          toolLines: f.toolLines.map((l) => (l.id === lineId ? { ...l, ...patch } : l))
        };
      })
    );
  }

  private commitToolLineFromText(formId: string, lineId: string): void {
    const form = this.forms().find((f) => f.id === formId);
    const line = form?.toolLines.find((l) => l.id === lineId);
    if (!form || !line) {
      return;
    }

    const parsed = this.parseFreeTextToolEntry(line.toolQuery, form);
    let toolId: number | null;
    let toolQuery: string;
    let selectedCodes: string[];
    let isTemporary = false;

    if (parsed) {
      toolId = parsed.tool.id;
      toolQuery = parsed.tool.displayName;

      if (parsed.codes.length === 0) {
        if (line.selectedCodes.length > 0) {
          const availableCodes = this.availableByTool().get(parsed.tool.id) ?? [];
          for (const code of line.selectedCodes) {
            if (!this.findCodeMatch(parsed.tool.serialCodes ?? [], code)) {
              this.toast.error(`הקוד "${code}" לא שייך לכלי "${parsed.tool.displayName}"`);
              this.focusToolLineInput(lineId);
              return;
            }
            if (!this.findCodeMatch(availableCodes, code)) {
              this.toast.warning(`הקוד "${code}" אינו זמין כרגע להשאלה`);
              this.focusToolLineInput(lineId);
              return;
            }
          }
          selectedCodes = [...line.selectedCodes];
        } else {
          this.forms.update((list) =>
            list.map((f) => {
              if (f.id !== formId) {
                return f;
              }
              return {
                ...f,
                toolLines: f.toolLines.map((l) =>
                  l.id !== lineId
                    ? l
                    : {
                        ...l,
                        toolId,
                        toolQuery,
                        selectedCodes: [],
                        isTemporary: false,
                        toolSuggestOpen: false,
                        codesOpen: false
                      }
                )
              };
            })
          );
          this.scheduleFocusCodesDropdown(formId, lineId);
          return;
        }
      }

      if (parsed.codes.length > 0) {
        const canonicalToolCodes = parsed.codes.map((code) =>
          this.findCodeMatch(parsed.tool.serialCodes ?? [], code)
        );
        const invalidCodeIndex = canonicalToolCodes.findIndex((code) => !code);
        if (invalidCodeIndex >= 0) {
          const badCode = parsed.codes[invalidCodeIndex];
          this.toast.error(`הקוד "${badCode}" לא שייך לכלי "${parsed.tool.displayName}"`);
          this.focusToolLineInput(lineId);
          return;
        }

        const availableCodes = this.availableByTool().get(parsed.tool.id) ?? [];
        const canonicalAvailableCodes = parsed.codes.map((code) =>
          this.findCodeMatch(availableCodes, code)
        );
        const unavailableCodeIndex = canonicalAvailableCodes.findIndex((code) => !code);
        if (unavailableCodeIndex >= 0) {
          const missingCode =
            canonicalToolCodes[unavailableCodeIndex] ?? parsed.codes[unavailableCodeIndex];
          this.toast.warning(`הקוד "${missingCode}" אינו זמין כרגע להשאלה`);
          this.focusToolLineInput(lineId);
          return;
        }

        toolId = parsed.tool.id;
        toolQuery = parsed.tool.displayName;
        selectedCodes = [
          ...new Set(canonicalAvailableCodes.filter((code): code is string => !!code))
        ];
      }
    } else {
      const temporary = this.parseTemporaryToolEntry(line.toolQuery, form);
      if (temporary) {
        toolId = null;
        toolQuery = temporary.toolName;
        selectedCodes = [...new Set(temporary.codes)];
        isTemporary = true;
        this.toast.warning(`"${temporary.toolName}" אינו במלאי — יתווסף כפריט חד-פעמי להשאלה זו`);
      } else if (line.isTemporary && line.toolQuery.trim()) {
        toolId = null;
        toolQuery = line.toolQuery.trim();
        selectedCodes = [...line.selectedCodes];
        isTemporary = true;
      } else if (line.toolId != null && line.selectedCodes.length > 0) {
        const tool = this.definitions().find((d) => d.id === line.toolId);
        if (!tool) {
          this.toast.error('הכלי שנבחר אינו קיים');
          this.focusToolLineInput(lineId);
          return;
        }

        const availableCodes = this.availableByTool().get(line.toolId) ?? [];
        for (const code of line.selectedCodes) {
          if (!this.findCodeMatch(tool.serialCodes ?? [], code)) {
            this.toast.error(`הקוד "${code}" לא שייך לכלי "${tool.displayName}"`);
            this.focusToolLineInput(lineId);
            return;
          }
          if (!this.findCodeMatch(availableCodes, code)) {
            this.toast.warning(`הקוד "${code}" אינו זמין כרגע להשאלה`);
            this.focusToolLineInput(lineId);
            return;
          }
        }

        toolId = line.toolId;
        toolQuery = tool.displayName;
        selectedCodes = [...line.selectedCodes];
      } else {
        this.toast.warning('הקלידו שם כלי ולפחות קוד אחד, למשל: מברגה 2 4 8');
        this.focusToolLineInput(lineId);
        return;
      }
    }

    const nextLineId = this.createToolLine().id;

    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        const updatedLines = f.toolLines.map((l) =>
          l.id !== lineId
            ? l
            : {
                ...l,
                toolId,
                toolQuery,
                selectedCodes,
                isTemporary,
                toolSuggestOpen: false,
                codesOpen: false
              }
        );
        const insertAt = updatedLines.findIndex((l) => l.id === lineId);
        const freshLine: ToolLineItem = {
          id: nextLineId,
          toolId: null,
          toolQuery: '',
          selectedCodes: [],
          isTemporary: false,
          toolSuggestOpen: false,
          codesOpen: false
        };
        const toolLines = [...updatedLines];
        toolLines.splice(insertAt + 1, 0, freshLine);
        return { ...f, toolLines };
      })
    );
    this.scheduleFocusToolLineInput(nextLineId);
  }

  private commitLineAndAddNext(formId: string, lineId: string): void {
    this.commitToolLineFromText(formId, lineId);
  }

  private activeLineIdForForm(formId: string): string | null {
    const active = this.document.activeElement as HTMLElement | null;
    if (!active) {
      return null;
    }
    const holder = active.closest<HTMLElement>('[data-line-id][data-form-id]');
    if (!holder) {
      return null;
    }
    if (holder.dataset['formId'] !== formId) {
      return null;
    }
    return holder.dataset['lineId'] ?? null;
  }

  private formHasHammerDrill(form: LendingDraftForm): boolean {
    return formHasHammerDrill(form.toolLines, (toolId) =>
      this.definitions().find((tool) => tool.id === toolId)?.displayName
    );
  }

  private tryResolveHammerDrillBitShortcut(formId: string, lineId: string): boolean {
    const form = this.forms().find((f) => f.id === formId);
    const line = form?.toolLines.find((l) => l.id === lineId);
    if (!form || !line || !this.formHasHammerDrill(form)) {
      return false;
    }

    const shortcut = parseHammerDrillBitShortcutInput(line.toolQuery);
    if (!shortcut) {
      return false;
    }

    const tool = findHammerDrillBitTool(this.definitions(), shortcut.size);
    if (!tool) {
      return false;
    }

    if (shortcut.codes.length > 0) {
      this.commitToolLineFromText(formId, lineId);
      return true;
    }

    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        return {
          ...f,
          toolLines: f.toolLines.map((l) =>
            l.id !== lineId
              ? l
              : {
                  ...l,
                  toolId: tool.id,
                  toolQuery: tool.displayName,
                  selectedCodes: [],
                  isTemporary: false,
                  toolSuggestOpen: false,
                  codesOpen: false
                }
          )
        };
      })
    );
    this.scheduleFocusCodesDropdown(formId, lineId);
    return true;
  }

  private parseFreeTextToolEntry(
    raw: string,
    form?: LendingDraftForm
  ): { tool: ToolDefinitionDto; codes: string[] } | null {
    const input = raw.trim();
    if (!input) {
      return null;
    }

    if (form && this.formHasHammerDrill(form)) {
      const shortcut = parseHammerDrillBitShortcutInput(input);
      if (shortcut) {
        const tool = findHammerDrillBitTool(this.definitions(), shortcut.size);
        if (tool) {
          return { tool, codes: shortcut.codes };
        }
      }
    }

    if (this.isStrictPrefixOfLongerCatalogToolName(input)) {
      return null;
    }

    const lower = input.toLocaleLowerCase();
    const defs = [...this.definitions()].sort(
      (a, b) => b.displayName.trim().length - a.displayName.trim().length
    );

    for (const tool of defs) {
      const name = tool.displayName.trim();
      const lowerName = name.toLocaleLowerCase();
      if (!lower.startsWith(lowerName)) {
        continue;
      }

      const remainder = input.slice(name.length).replace(/^[\s\-:;,#/\\]+/, '').trim();
      if (!remainder) {
        return { tool, codes: [] };
      }

      const codes = remainder
        .split(/[\s,;|/\\]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
      if (codes.length === 0) {
        continue;
      }

      return { tool, codes };
    }

    return null;
  }

  private isStrictPrefixOfLongerCatalogToolName(input: string): boolean {
    const lower = input.trim().toLocaleLowerCase();
    const isExactCatalogName = this.definitions().some(
      (tool) => tool.displayName.trim().toLocaleLowerCase() === lower
    );
    if (isExactCatalogName) {
      return false;
    }

    return this.definitions().some((tool) => {
      const lowerName = tool.displayName.trim().toLocaleLowerCase();
      return lowerName.startsWith(lower) && lowerName !== lower;
    });
  }

  private isIncompleteCatalogEntry(input: string): boolean {
    const trimmed = input.trim();
    if (!trimmed) {
      return true;
    }
    if (this.isStrictPrefixOfLongerCatalogToolName(trimmed)) {
      return true;
    }

    const lower = trimmed.toLocaleLowerCase();
    return this.definitions().some((tool) => {
      const name = tool.displayName.trim().toLocaleLowerCase();
      return name.startsWith(lower) && name !== lower;
    });
  }

  private parseTemporaryToolEntry(
    raw: string,
    form?: LendingDraftForm
  ): { toolName: string; codes: string[] } | null {
    const input = raw.trim();
    if (
      !input ||
      this.parseFreeTextToolEntry(input, form) !== null ||
      this.isIncompleteCatalogEntry(input)
    ) {
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

    const toolName = tokens.slice(0, splitAt).join(' ').trim();
    const codes = tokens.slice(splitAt);
    if (!toolName) {
      return null;
    }

    return { toolName, codes };
  }

  private isUncommittedTemporaryLine(line: ToolLineItem, form: LendingDraftForm): boolean {
    if (line.toolId != null || !line.toolQuery.trim()) {
      return false;
    }
    return this.parseTemporaryToolEntry(line.toolQuery, form) !== null;
  }

  private findCodeMatch(codes: string[], candidate: string): string | null {
    const normalized = candidate.trim().toLocaleLowerCase();
    if (!normalized) {
      return null;
    }
    return codes.find((code) => code.trim().toLocaleLowerCase() === normalized) ?? null;
  }

  private focusToolLineInput(lineId: string): void {
    const input = this.document.querySelector<HTMLInputElement>(
      `[data-tool-line-input][data-line-id="${lineId}"]`
    );
    input?.focus();
    input?.select();
  }

  private scheduleFocusToolLineInput(lineId: string): void {
    afterNextRender(
      () => {
        const input = this.document.querySelector<HTMLInputElement>(
          `[data-tool-line-input][data-line-id="${lineId}"]`
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

  private scheduleFocusCodesDropdown(formId: string, lineId: string): void {
    afterNextRender(
      () => {
        this.patchToolLineUi(formId, lineId, { codesOpen: true });
        const button = this.document.querySelector<HTMLButtonElement>(
          `[data-codes-dropdown] button[data-line-id="${lineId}"][data-form-id="${formId}"]`
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

  private buildLoanItems(form: LendingDraftForm): ToolLoanCreateDto['items'] | null {
    const items: ToolLoanCreateDto['items'] = [];

    for (const line of form.toolLines) {
      if (line.isTemporary || this.isUncommittedTemporaryLine(line, form)) {
        const parsedTemp = line.isTemporary ? null : this.parseTemporaryToolEntry(line.toolQuery, form);
        const name = (parsedTemp?.toolName ?? line.toolQuery).trim();
        if (!name) {
          if (line.selectedCodes.length > 0) {
            this.toast.error('יש להזין שם כלי תקין בכל שורה');
            return null;
          }
          continue;
        }
        const codes =
          line.selectedCodes.length > 0
            ? line.selectedCodes
            : parsedTemp && parsedTemp.codes.length > 0
              ? parsedTemp.codes
              : [''];
        for (const code of codes) {
          items.push({
            toolDefinitionId: 0,
            serialCode: code,
            toolName: name
          });
        }
        continue;
      }

      if (line.toolId == null) {
        if (line.toolQuery.trim() || line.selectedCodes.length > 0) {
          this.toast.error('יש להזין שם כלי וקוד פריט תקינים בכל שורה');
          return null;
        }
        continue;
      }
      if (line.selectedCodes.length === 0) {
        this.toast.error(`יש לבחור לפחות קוד פריט עבור ${line.toolQuery || 'הכלי שנבחר'}`);
        return null;
      }
      for (const code of line.selectedCodes) {
        items.push({ toolDefinitionId: line.toolId, serialCode: code });
      }
    }

    if (items.length === 0) {
      this.toast.error('יש להוסיף לפחות כלי אחד');
      return null;
    }
    return items;
  }

  private wireCustomerSuggestDebounce(): void {
    this.customerSuggestQuery$
      .pipe(
        debounceTime(300),
        switchMap(({ formId, field, q }) => {
          const trimmed = q.trim();
          if (trimmed.length < 2) {
            this.closeCustomerSuggest();
            this.customerSuggestions.set([]);
            return EMPTY;
          }
          return this.customers.searchSuggest(trimmed).pipe(
            map((hits) => ({ formId, field, hits }))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ formId, field, hits }) => {
        if (this.customerSuggestFormId() !== formId) {
          return;
        }
        this.customerSuggestField.set(field);
        this.customerSuggestions.set(hits.slice(0, 8));
        this.customerSuggestOpen.set(hits.length > 0);
      });
  }

  private openCustomerSuggest(formId: string, field: 'name' | 'phone', q: string): void {
    this.closeInstitutionSuggest();
    this.customerSuggestFormId.set(formId);
    this.customerSuggestField.set(field);
    this.closeToolUi();
    this.customerSuggestQuery$.next({ formId, field, q });
  }

  private loadDefinitions(): void {
    this.toolStore.load().subscribe(() => {
      this.tryApplyRenewPrefill();
    });
    // Exactly one availability request for the whole page (not per row/tool).
    this.refreshAvailability();
  }

  private readRenewQueryParams(): void {
    const qp = this.route.snapshot.queryParamMap;
    const phone = (qp.get('renewPhone') ?? '').trim();
    const toolId = Number(qp.get('toolId'));
    const serialCode = (qp.get('serialCode') ?? '').trim();
    if (!phone || !Number.isFinite(toolId) || toolId <= 0 || !serialCode) {
      return;
    }

    this.pendingRenew = {
      phone,
      clientName: (qp.get('renewName') ?? '').trim(),
      phone2: (qp.get('renewPhone2') ?? '').trim(),
      address: (qp.get('renewAddress') ?? '').trim(),
      toolId,
      serialCode
    };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      replaceUrl: true
    });
  }

  private tryApplyRenewPrefill(): void {
    const pending = this.pendingRenew;
    if (!pending) {
      return;
    }

    const def = this.definitions().find((d) => d.id === pending.toolId);
    if (!def) {
      this.pendingRenew = null;
      this.toast.error('הפריט לא נמצא במלאי');
      return;
    }

    this.pendingRenew = null;
    const draft = this.createDraftForm();
    draft.clientName = pending.clientName;
    draft.phone = pending.phone;
    draft.phone2 = pending.phone2;
    draft.address = pending.address;
    draft.toolLines = [
      {
        id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        toolId: def.id,
        toolQuery: def.displayName,
        selectedCodes: [pending.serialCode],
        isTemporary: false,
        toolSuggestOpen: false,
        codesOpen: false
      }
    ];
    this.forms.set([draft]);
    if (pending.phone.replace(/\D/g, '').length >= 9) {
      this.lookupClientNotesByPhone(draft.id, pending.phone.replace(/\D/g, ''));
    }
    this.queueCustomerRiskLookup(draft.id);
  }

  private refreshAvailability(): void {
    this.data.getAllAvailableToolSerials().subscribe((groups) => {
      const map = new Map<number, string[]>();
      for (const group of groups) {
        map.set(group.toolDefinitionId, group.serialCodes ?? []);
      }
      this.availableByTool.set(map);
    });
  }

  private wireTimeLimitHours(): void {
    this.timeLimitForm.controls.hours.valueChanges
      .pipe(debounceTime(150), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.timeLimitEnabled()) {
          this.recomputeAllDeadlines();
        }
      });
  }

  /** Called directly from (input)/(search) DOM events — reliable in zoneless apps. */
  protected onActiveSearchInput(value: string): void {
    this.activeSearchQuery.set(value);
  }

  protected clearActiveSearch(): void {
    this.activeSearchInput.setValue('');
    this.activeSearchQuery.set('');
  }

  private recomputeAllDeadlines(): void {
    const hours = Number(this.timeLimitForm.controls.hours.value) || 0;
    this.forms.update((list) =>
      list.map((f) => ({
        ...f,
        deadlineAt: this.computeDeadline(f.createdAt, hours)
      }))
    );
  }

  private isTimeLimitEnabled(): boolean {
    const sig = this.timeLimitEnabled;
    return typeof sig === 'function' ? sig() : false;
  }

  private computeDeadline(lentAt: Date, hours: number): Date | null {
    if (!this.isTimeLimitEnabled() || hours <= 0) {
      return null;
    }
    return new Date(lentAt.getTime() + hours * 3_600_000);
  }

  private createToolLine(): ToolLineItem {
    return {
      id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolId: null,
      toolQuery: '',
      selectedCodes: [],
      isTemporary: false,
      toolSuggestOpen: false,
      codesOpen: false
    };
  }

  private createDraftForm(): LendingDraftForm {
    const createdAt = new Date();
    const hours = Number(this.timeLimitForm?.controls.hours.value) || 2;
    const timeLimitOn = this.isTimeLimitEnabled();
    return {
      id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt,
      hebrewDateTime: this.formatHebrewDateTime(createdAt),
      toolLines: [this.createToolLine()],
      clientName: '',
      phone: '',
      phone2: '',
      address: '',
      institutionName: '',
      institutionId: null,
      deposit: '',
      notes: '',
      clientAlertNotes: null,
      clientRiskAlerts: EMPTY_CUSTOMER_RISK_ALERTS,
      deadlineAt: timeLimitOn ? this.computeDeadline(createdAt, hours) : null
    };
  }

  private formatHebrewDateTime(date: Date, withSeconds = false): string {
    return this.hebrew.formatHebrewDateTime(date, withSeconds);
  }
}
