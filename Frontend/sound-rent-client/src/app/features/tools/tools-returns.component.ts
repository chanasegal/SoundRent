import { CommonModule, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  isDevMode,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { ConfirmPopup } from 'primeng/confirmpopup';
import { forkJoin, interval, of } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { DEPOSIT_TYPE_LABELS } from '../../core/models/enums';
import { ReturnedAccessoryHistoryDto } from '../../core/models/equipment-return.model';
import {
  ToolItemBorrowHistoryDto,
  ToolLoanDto,
  ToolLoanItemDto
} from '../../core/models/tools-workspace.model';
import { CustomersStore } from '../../core/services/customers.store';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { OrdersSyncService } from '../../core/services/orders-sync.service';
import { ToolDefinitionsStore } from '../../core/services/tool-definitions.store';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import { startLiveDataRefresh } from '../../core/utils/live-data-refresh';
import {
  parseLoanTimestamp,
  resolveLoanInstant,
  toLocalIsoDay
} from '../../core/utils/loan-datetime';
import { sortNumericCodes } from '../../core/utils/numeric-code-sort';
import {
  formatCalendarDuration,
  isNonBillableDay
} from '../../core/utils/tools-billable-duration';
import { CashDepositAlertComponent } from '../../shared/components/cash-deposit-alert.component';
import { LoanRangeCalendarHostComponent } from '../../shared/components/loan-range-calendar-host.component';
import { ToolTypeSelectComponent } from '../../shared/components/tool-type-select.component';
import { ClickOutsideDirective } from '../../shared/directives/click-outside.directive';

interface CompletedLoanRowView {
  rowKey: string;
  source: 'tools' | 'accessory';
  loanId: number;
  itemId: number;
  loanedEquipmentId: number | null;
  accessoryQuantity: number;
  customerDebtId: number | null;
  item: Pick<ToolLoanItemDto, 'toolName' | 'serialCode'>;
  clientName: string;
  phone: string;
  address: string;
  deposit: string;
  cashDepositAmount: number | null;
  depositReturned: boolean;
  loanNotes: string;
  lentAt: Date;
  hebrewLentDisplay: string;
  deadlineAt: Date | null;
  returnedAt: Date;
  hebrewReturnedDisplay: string;
  chargeAmount: number | null;
  chargeIsPaid: boolean | null;
}

/** Same tool/accessory name + borrow date within a return card. */
interface GroupedCompletedLoanRowView {
  rowKey: string;
  source: CompletedLoanRowView['source'];
  loanId: number;
  toolName: string;
  quantity: number;
  serialCodes: string[];
  members: CompletedLoanRowView[];
  lentAt: Date;
  hebrewLentDisplay: string;
  deadlineAt: Date | null;
  returnedAt: Date;
  hebrewReturnedDisplay: string;
  chargeAmount: number | null;
  chargeIsPaid: boolean | null;
  /** First unpaid debt id, if any member can be quick-paid. */
  customerDebtId: number | null;
}

/** One card per customer + loan, mirroring the lending page's customer cards. */
interface ReturnedLoanCard {
  key: string;
  source: CompletedLoanRowView['source'];
  loanId: number;
  customerName: string;
  phone: string;
  address: string;
  hebrewLentDisplay: string;
  latestReturnedAt: Date;
  deposit: string;
  cashDepositAmount: number | null;
  depositReturned: boolean;
  loanNotes: string;
  customerNotes: string | null;
  items: GroupedCompletedLoanRowView[];
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
  lentAt: Date;
  deadlineAt: Date | null;
  hebrewLentDisplay: string;
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

interface ActiveLoanRowView {
  rowKey: string;
  loanId: number;
  itemId: number | null;
  item: ToolLoanItemDto;
  clientName: string;
  phone: string;
  address: string;
  lentAt: Date;
  deadlineAt: Date | null;
}

@Component({
  selector: 'app-tools-returns',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    ToolTypeSelectComponent,
    LoanRangeCalendarHostComponent,
    ClickOutsideDirective,
    ConfirmPopup,
    CashDepositAlertComponent
  ],
  providers: [ConfirmationService],
  templateUrl: './tools-returns.component.html',
  styleUrl: './tools-returns.component.scss'
})
export class ToolsReturnsComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly ordersSync = inject(OrdersSyncService);
  private readonly toolStore = inject(ToolDefinitionsStore);
  private readonly customers = inject(CustomersStore);
  private readonly hebrew = inject(HebrewDateService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly pageTitle = inject(WorkspaceUiService).title('החזרות');

  protected readonly loading = signal(true);
  protected readonly loans = signal<ToolLoanDto[]>([]);
  protected readonly accessoryReturns = signal<ReturnedAccessoryHistoryDto[]>([]);
  protected readonly activeLoans = signal<ToolLoanDto[]>([]);
  protected readonly definitions = this.toolStore.definitions;
  protected readonly markingDebtId = signal<number | null>(null);
  protected readonly undoingRowKey = signal<string | null>(null);
  protected readonly deletingLoanId = signal<number | null>(null);
  protected readonly quickReturnToolId = signal<number | null>(null);
  protected readonly quickReturnCode = signal('');
  protected readonly quickReturnCharge = signal('');
  protected readonly quickReturnCodeOpen = signal(false);
  protected readonly quickReturnSearching = signal(false);
  protected readonly quickReturnSaving = signal(false);
  protected readonly quickReturnSession = signal<QuickReturnSession | null>(null);
  protected readonly nowTick = signal(Date.now());

  /** Audit search — isolated to this component. */
  protected readonly historyToolId = signal<number | null>(null);
  protected readonly historyCode = signal('');
  protected readonly historySearching = signal(false);
  protected readonly historyMode = signal(false);
  protected readonly historyRows = signal<CompletedLoanRowView[]>([]);

  protected readonly historyCodes = computed(() => {
    const toolId = this.historyToolId();
    if (toolId == null) {
      return [] as string[];
    }
    const def = this.definitions().find((d) => d.id === toolId);
    return sortNumericCodes(def?.serialCodes ?? []);
  });

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

  protected readonly allCompletedRows = computed(() => {
    const views: CompletedLoanRowView[] = [];

    for (const loan of this.loans()) {
      // Parent loan creation stamp — safe fallback when a line lacks addedAt.
      const loanLentAt = resolveLoanInstant(loan.lentAt);
      const deadlineAt = resolveLoanInstant(loan.deadlineAt);

      for (const item of loan.items) {
        if (!item.returnedAt) {
          continue;
        }
        const lentAt = resolveLoanInstant(item.addedAt, loanLentAt, loan.lentAt);
        const returnedAt = resolveLoanInstant(item.returnedAt, lentAt);
        if (!lentAt || !returnedAt) {
          continue;
        }
        views.push({
          rowKey: `${loan.id}-${item.id}`,
          source: 'tools',
          loanId: loan.id,
          itemId: item.id,
          loanedEquipmentId: null,
          accessoryQuantity: 1,
          customerDebtId: item.customerDebtId ?? null,
          item,
          clientName: loan.clientName,
          phone: loan.phone,
          address: (loan.address ?? '').trim(),
          deposit: (loan.deposit ?? '').trim(),
          cashDepositAmount: loan.cashDepositAmount ?? null,
          depositReturned: loan.depositReturned === true,
          loanNotes: (loan.notes ?? '').trim(),
          lentAt,
          hebrewLentDisplay:
            (loanLentAt && lentAt.getTime() === loanLentAt.getTime()
              ? loan.hebrewLentDisplay
              : '') || this.formatHebrewDateTime(lentAt),
          deadlineAt,
          returnedAt,
          hebrewReturnedDisplay:
            item.hebrewReturnedDisplay?.trim() || this.formatHebrewDateTime(returnedAt, true),
          chargeAmount: item.chargeAmount ?? null,
          chargeIsPaid: item.chargeIsPaid ?? null
        });
      }
    }

    for (const acc of this.accessoryReturns()) {
      if (acc.isOrderBased) {
        continue;
      }
      // Prefer full timestamps (hours/minutes); fall back to calendar days, then skip
      // the row rather than inventing epoch/zero dates that corrupt Hebrew + duration.
      const hasLentTime = !!parseLoanTimestamp(acc.lentAt);
      const hasReturnTime = !!parseLoanTimestamp(acc.returnedAt);
      const lentAt = resolveLoanInstant(acc.lentAt, acc.loanDate);
      const returnedAt = resolveLoanInstant(acc.returnedAt, acc.returnDate, lentAt);
      if (!lentAt || !returnedAt) {
        continue;
      }
      const serial = (acc.serialCode ?? '').trim();
      views.push({
        rowKey: `accessory-${acc.orderId}-${acc.loanedEquipmentId}-${serial || 'qty'}`,
        source: 'accessory',
        loanId: acc.orderId,
        itemId: acc.loanedEquipmentId,
        loanedEquipmentId: acc.loanedEquipmentId,
        accessoryQuantity: acc.quantity || 1,
        customerDebtId: null,
        item: {
          toolName: acc.itemName,
          serialCode: serial
        },
        clientName: acc.customerName ?? '',
        phone: acc.phone,
        address: (acc.address ?? '').trim(),
        deposit: this.formatAccessoryDeposit(acc),
        cashDepositAmount: null,
        depositReturned: false,
        loanNotes: (acc.notes ?? '').trim(),
        lentAt,
        hebrewLentDisplay: hasLentTime
          ? this.formatHebrewDateTime(lentAt)
          : this.hebrew.toHebrew(lentAt),
        deadlineAt: null,
        returnedAt,
        hebrewReturnedDisplay: hasReturnTime
          ? this.formatHebrewDateTime(returnedAt)
          : this.hebrew.toHebrew(returnedAt),
        chargeAmount: null,
        chargeIsPaid: null
      });
    }

    return views.sort((a, b) => b.returnedAt.getTime() - a.returnedAt.getTime());
  });

  protected readonly rows = computed(() =>
    this.historyMode() ? this.historyRows() : this.allCompletedRows()
  );

  protected readonly returnSearchQuery = signal('');

  protected readonly filteredRows = computed(() => {
    const raw = this.returnSearchQuery().trim().toLowerCase();
    const all = this.rows();
    if (!raw) {
      return all;
    }
    const needleDigits = raw.replace(/\D/g, '');
    return all.filter((row) => {
      if ((row.clientName ?? '').toLowerCase().includes(raw)) {
        return true;
      }
      if (needleDigits && (row.phone ?? '').replace(/\D/g, '').includes(needleDigits)) {
        return true;
      }
      if ((row.item.toolName ?? '').toLowerCase().includes(raw)) {
        return true;
      }
      if ((row.item.serialCode ?? '').toLowerCase().includes(raw)) {
        return true;
      }
      return false;
    });
  });

  protected readonly returnedCards = computed(() => {
    this.customers.customers();
    const byLoan = new Map<
      string,
      Omit<ReturnedLoanCard, 'items'> & { rawItems: CompletedLoanRowView[] }
    >();

    for (const row of this.filteredRows()) {
      const key = `${row.source}|${row.loanId}|${(row.clientName ?? '').trim()}|${this.normalizePhone(row.phone)}`;
      let card = byLoan.get(key);
      if (!card) {
        card = {
          key,
          source: row.source,
          loanId: row.loanId,
          customerName: row.clientName,
          phone: row.phone,
          address: row.address,
          hebrewLentDisplay: row.hebrewLentDisplay,
          latestReturnedAt: row.returnedAt,
          deposit: row.deposit,
          cashDepositAmount: row.cashDepositAmount,
          depositReturned: row.depositReturned,
          loanNotes: row.loanNotes,
          customerNotes: this.customers.notesForPhone(row.phone),
          rawItems: []
        };
        byLoan.set(key, card);
      }
      if (row.returnedAt.getTime() > card.latestReturnedAt.getTime()) {
        card.latestReturnedAt = row.returnedAt;
      }
      card.rawItems.push(row);
    }

    return [...byLoan.values()]
      .map(({ rawItems, ...rest }): ReturnedLoanCard => {
        const items = this.groupCompletedLoanRows(rawItems);
        const earliest = items.reduce(
          (a, b) => (b.lentAt < a.lentAt ? b : a),
          items[0]
        );
        return {
          ...rest,
          hebrewLentDisplay: earliest?.hebrewLentDisplay ?? rest.hebrewLentDisplay,
          items
        };
      })
      .sort((a, b) => b.latestReturnedAt.getTime() - a.latestReturnedAt.getTime());
  });

  ngOnInit(): void {
    this.toolStore.load().subscribe();
    this.customers.load().subscribe();
    this.refresh();
    this.refreshActiveLoans();

    this.ordersSync.loanChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.refresh();
        this.refreshActiveLoans();
      });
    this.ordersSync.orderChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.refresh();
        this.refreshActiveLoans();
      });
    this.ordersSync.debtChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refresh());

    interval(60_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.nowTick.set(Date.now()));

    startLiveDataRefresh(
      this.destroyRef,
      () => {
        this.refresh();
        this.refreshActiveLoans();
      },
      {
        skipWhen: () =>
          this.loading() ||
          this.quickReturnSaving() ||
          this.quickReturnSearching() ||
          this.markingDebtId() != null ||
          this.undoingRowKey() != null ||
          this.deletingLoanId() != null ||
          this.quickReturnSession() != null
      }
    );

    if (isDevMode()) {
      (window as unknown as Record<string, unknown>)['debugReturns'] = (loanId: number) =>
        this.debugLoanCalculation(loanId);
      console.info(
        '[tools-returns] Debug helper ready — run debugReturns(<loanId>) in the console.'
      );
    }
  }

  protected closeQuickReturnCodePanel(): void {
    this.quickReturnCodeOpen.set(false);
  }

  /**
   * DEBUG (dev only): prints the day-by-day billable-day calculation for every
   * returned item of a loan. Call `debugReturns(loanId)` from the browser console
   * while on the Tools returns page.
   */
  debugLoanCalculation(loanId: number): void {
    const matches = this.rows().filter((r) => r.loanId === loanId);
    if (!matches.length) {
      console.warn(`[tools-returns] No returned rows found for loan #${loanId}.`);
      return;
    }

    for (const row of matches) {
      console.group(
        `Loan #${row.loanId} · item ${row.itemId} · ${row.item.toolName} (${row.item.serialCode})`
      );
      console.log(`Loan timestamp:   ${row.lentAt.toString()}`);
      console.log(`Return timestamp: ${row.returnedAt.toString()}`);
      // Passing loanId turns on the per-day Counting/Skipping logging.
      const days = this.calculateBillableDays(row.lentAt, row.returnedAt, row.loanId);
      console.log(`Charge: ${days > 1 ? days * 5 : 0} ₪`);
      console.groupEnd();
    }
  }

  protected refresh(): void {
    this.loading.set(true);
    forkJoin({
      loans: this.data.getToolLoans(),
      accessories: this.data.getReturnedAccessories()
    })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe(({ loans, accessories }) => {
        this.loans.set(loans);
        this.accessoryReturns.set(accessories);
      });
  }

  protected refreshActiveLoans(): void {
    this.data.getActiveToolLoans().subscribe((list) => {
      this.activeLoans.set(list);
    });
  }

  protected onHistoryToolChange(toolId: number | null): void {
    this.historyToolId.set(toolId != null && toolId > 0 ? toolId : null);
    this.historyCode.set('');
  }

  protected onHistoryCodeInput(value: string): void {
    this.historyCode.set(value);
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

  protected searchItemHistory(): void {
    const toolId = this.historyToolId();
    const serial = this.historyCode().trim();
    if (toolId == null) {
      this.toast.error('יש לבחור סוג כלי');
      return;
    }
    if (!serial) {
      this.toast.error('יש להזין קוד פריט');
      return;
    }

    this.historySearching.set(true);
    this.data
      .getToolItemBorrowHistory(toolId, serial)
      .pipe(finalize(() => this.historySearching.set(false)))
      .subscribe((list) => {
        this.historyRows.set(
          list.map((h) => this.toHistoryRow(h)).filter((row): row is CompletedLoanRowView => row != null)
        );
        this.historyMode.set(true);
      });
  }

  protected clearHistorySearch(): void {
    this.historyMode.set(false);
    this.historyRows.set([]);
    this.historyToolId.set(null);
    this.historyCode.set('');
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

  protected quickReturnDurationText(item: QuickReturnItem): string {
    return formatCalendarDuration(item.lentAt, new Date(this.nowTick()));
  }

  protected quickReturnItemOverdue(item: QuickReturnItem): boolean {
    if (!item.deadlineAt) {
      return false;
    }
    return new Date(this.nowTick()).getTime() > item.deadlineAt.getTime();
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
    const requests = selected.map((item) =>
      this.data.returnToolLoanItem(item.loanId, item.itemId, {
        hebrewReturnedDisplay: hebrew,
        chargeAmount: item.isScannedMatch && barCharge && barCharge > 0 ? barCharge : null
      })
    );

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
          selected.length === 1 ? 'הקוד הוחזר בהצלחה' : `${okCount} קודים הוחזרו בהצלחה`
        );
        this.quickReturnSession.set(null);
        this.quickReturnCode.set('');
        this.quickReturnCharge.set('');
        this.ordersSync.notifyLoanChanged();
        this.refreshActiveLoans();
        this.refresh();
        queueMicrotask(() => this.focusQuickReturnCodeInput());
      });
  }

  protected formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
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

  protected formatDeadline(deadline: Date | null): string {
    if (!deadline) {
      return '—';
    }
    const hh = String(deadline.getHours()).padStart(2, '0');
    const mm = String(deadline.getMinutes()).padStart(2, '0');
    return `${this.hebrew.toHebrew(deadline)} ${hh}:${mm}`;
  }

  protected durationText(row: Pick<GroupedCompletedLoanRowView, 'lentAt' | 'returnedAt'>): string {
    return formatCalendarDuration(row.lentAt, row.returnedAt);
  }

  /** Local `YYYY-MM-DD` — built from local Y/M/D so no UTC/TZ day-shift occurs. */
  private toIsoDay(date: Date): string {
    return toLocalIsoDay(date);
  }

  /**
   * Billable days between loan and return dates.
   *
   * - **Date-only:** both endpoints are rebuilt from their local year/month/date
   *   (`new Date(y, m, d)`), so time components and UTC/local offsets can never
   *   shift the day boundary. The span is [loanDate, returnDate) — end-exclusive.
   * - Counts every weekday **including Fridays**; skips Saturdays (Shabbat),
   *   Jewish holidays (Yom Tov) and Chol HaMoed via the shared
   *   `@hebcal`-based `isNonBillableDay` predicate.
   * - **Logging:** when a `loanId` is supplied (dev mode), each day is logged
   *   exactly once inside a `console.group` as either `Counting day` or
   *   `Skipping day`, so the calculation can be traced per loan record.
   */
  protected calculateBillableDays(
    loanDate: Date,
    returnDate: Date,
    loanId?: number
  ): number {
    if (
      !(loanDate instanceof Date) ||
      !(returnDate instanceof Date) ||
      Number.isNaN(loanDate.getTime()) ||
      Number.isNaN(returnDate.getTime())
    ) {
      return 0;
    }

    // Normalize to calendar days (drop time + timezone) for stable comparison.
    const cursor = new Date(loanDate.getFullYear(), loanDate.getMonth(), loanDate.getDate());
    const endDay = new Date(
      returnDate.getFullYear(),
      returnDate.getMonth(),
      returnDate.getDate()
    );
    if (endDay <= cursor) {
      return 0;
    }

    const debug = loanId != null && isDevMode();
    if (debug) {
      console.group(`calculateBillableDays — Loan #${loanId}`);
      console.log(`Range: ${this.toIsoDay(cursor)} → ${this.toIsoDay(endDay)} (end exclusive)`);
    }

    let days = 0;
    // Efficient loop: mutate a single Date in place instead of allocating each day.
    for (; cursor < endDay; cursor.setDate(cursor.getDate() + 1)) {
      const iso = this.toIsoDay(cursor);
      if (isNonBillableDay(cursor)) {
        // Excluded branch — log the skip exactly here so each day is logged once.
        if (debug) {
          console.log(`Skipping day: ${iso}`);
        }
        continue;
      }

      days += 1;
      if (debug) {
        console.log(`Counting day: ${iso}`);
      }
    }

    if (debug) {
      console.log(`Total billable days: ${days}`);
      console.groupEnd();
    }

    return days;
  }

  /** Charge: free for a single billable day or less, otherwise billable days × 5 ₪. */
  protected calculateCharge(loanDate: Date, returnDate: Date): number {
    const days = this.calculateBillableDays(loanDate, returnDate);
    return days > 1 ? days * 5 : 0;
  }

  protected isOverdue(row: Pick<GroupedCompletedLoanRowView, 'deadlineAt' | 'returnedAt'>): boolean {
    if (!row.deadlineAt) {
      return false;
    }
    return row.returnedAt.getTime() > row.deadlineAt.getTime();
  }

  protected formatCharge(amount: number | null): string {
    if (amount == null || amount <= 0) {
      return '—';
    }
    const rounded = Math.round(amount * 100) / 100;
    return Number.isInteger(rounded) ? `₪ ${rounded}` : `₪ ${rounded.toFixed(2)}`;
  }

  protected hasCharge(row: Pick<GroupedCompletedLoanRowView, 'chargeAmount'>): boolean {
    return row.chargeAmount != null && row.chargeAmount > 0;
  }

  protected cardTotalCharge(card: ReturnedLoanCard): number {
    return card.items.reduce(
      (sum, row) => sum + (this.hasCharge(row) ? (row.chargeAmount as number) : 0),
      0
    );
  }

  protected formatChargeTotal(amount: number): string {
    const rounded = Math.round(amount * 100) / 100;
    return Number.isInteger(rounded) ? `₪${rounded}` : `₪${rounded.toFixed(2)}`;
  }

  protected isCardBusy(card: ReturnedLoanCard): boolean {
    if (this.deletingLoanId() === card.loanId) {
      return true;
    }
    const undoing = this.undoingRowKey();
    return undoing != null && card.items.some((row) => row.rowKey === undoing);
  }

  private formatAccessoryDeposit(acc: ReturnedAccessoryHistoryDto): string {
    const typeLabel = acc.depositType != null ? DEPOSIT_TYPE_LABELS[acc.depositType] ?? '' : '';
    const onName = (acc.depositOnName ?? '').trim();
    if (typeLabel && onName) {
      return `${typeLabel} — ${onName}`;
    }
    return typeLabel || onName;
  }

  protected canQuickPay(row: GroupedCompletedLoanRowView): boolean {
    return (
      this.hasCharge(row) &&
      row.chargeIsPaid !== true &&
      row.customerDebtId != null &&
      row.customerDebtId > 0
    );
  }

  protected onOpenBadgeClick(event: Event, row: GroupedCompletedLoanRowView): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canQuickPay(row) || this.markingDebtId() != null) {
      return;
    }

    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message: 'סמן חוב זה כמשולם?',
      acceptLabel: 'כן',
      rejectLabel: 'ביטול',
      acceptButtonStyleClass: 'p-button-sm',
      rejectButtonStyleClass: 'p-button-sm p-button-outlined',
      accept: () => this.markGroupedDebtsPaid(row)
    });
  }

  protected onUndoReturnClick(event: Event, row: GroupedCompletedLoanRowView): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.undoingRowKey() != null || this.deletingLoanId() != null) {
      return;
    }

    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message: 'האם לבטל את ההחזרה ולהחזיר את הפריט לרשימת ההשאלות הפעילות?',
      acceptLabel: 'כן',
      rejectLabel: 'ביטול',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-sm p-button-outlined',
      accept: () => this.undoGroupedReturn(row)
    });
  }

  protected onDeleteLoanClick(event: Event, row: GroupedCompletedLoanRowView): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.undoingRowKey() != null || this.deletingLoanId() != null) {
      return;
    }

    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message:
        row.source === 'tools'
          ? 'האם למחוק לחלוטין את רשומת ההשאלה הזו מהמערכת? (פעולה זו בלתי הפיכה ותמחק גם חובות קשורים)'
          : 'האם למחוק את רשומת ההחזרה לצמיתות?',
      acceptLabel: 'מחק',
      rejectLabel: 'ביטול',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-sm p-button-outlined',
      accept: () => this.deleteGroupedLoan(row)
    });
  }

  private undoGroupedReturn(group: GroupedCompletedLoanRowView): void {
    if (group.members.length === 0) {
      return;
    }
    this.undoingRowKey.set(group.rowKey);

    if (group.source === 'accessory') {
      const requests = group.members.map((row) => {
        if (row.loanedEquipmentId == null) {
          return of(null);
        }
        const serial = row.item.serialCode.trim();
        return this.data.undoOrderReturn(row.loanId, {
          loanedEquipmentId: row.loanedEquipmentId,
          serialCode: serial || null,
          quantity: serial ? null : row.accessoryQuantity
        });
      });
      forkJoin(requests)
        .pipe(finalize(() => this.undoingRowKey.set(null)))
        .subscribe((results) => {
          const updated = results.find((r) => !!r) ?? null;
          if (!updated) {
            return;
          }
          this.removeGroupedReturnedLocally(group);
          this.ordersSync.notifyOrderUpdated(updated);
          this.toast.success('ההחזרה בוטלה — הפריט חזר להשאלות פעילות');
        });
      return;
    }

    const requests = group.members.map((row) =>
      this.data.undoToolLoanItemReturn(row.loanId, row.itemId)
    );
    forkJoin(requests)
      .pipe(finalize(() => this.undoingRowKey.set(null)))
      .subscribe((results) => {
        if (!results.some((r) => !!r)) {
          return;
        }
        this.removeGroupedReturnedLocally(group);
        this.ordersSync.notifyLoanChanged();
        this.ordersSync.notifyDebtChanged();
        this.toast.success('ההחזרה בוטלה — הפריט חזר להשאלות פעילות');
      });
  }

  private deleteGroupedLoan(group: GroupedCompletedLoanRowView): void {
    this.deletingLoanId.set(group.loanId);
    if (group.source === 'accessory') {
      const requests = group.members.map((row) => {
        if (row.loanedEquipmentId == null) {
          return of(false);
        }
        const serial = row.item.serialCode.trim();
        return this.data.deleteReturnedAccessory(row.loanId, {
          loanedEquipmentId: row.loanedEquipmentId,
          serialCode: serial || null,
          quantity: serial ? null : row.accessoryQuantity
        });
      });
      forkJoin(requests)
        .pipe(finalize(() => this.deletingLoanId.set(null)))
        .subscribe((results) => {
          if (!results.some((r) => !!r)) {
            return;
          }
          this.removeGroupedReturnedLocally(group);
          this.ordersSync.notifyLoanChanged();
          this.toast.success('רשומת ההחזרה נמחקה');
        });
      return;
    }

    this.data
      .deleteToolLoan(group.loanId)
      .pipe(finalize(() => this.deletingLoanId.set(null)))
      .subscribe((ok) => {
        if (!ok) {
          return;
        }
        this.removeLoanLocally(group.loanId);
        this.ordersSync.notifyLoanChanged();
        this.ordersSync.notifyDebtChanged();
        this.toast.success('רשומת ההשאלה נמחקה');
      });
  }

  /** Drop every member of a grouped return from local lists without a full reload. */
  private removeGroupedReturnedLocally(group: GroupedCompletedLoanRowView): void {
    for (const row of group.members) {
      this.removeReturnedRowLocally(row);
    }
  }

  /** Drop the undone item from local lists without a full reload. */
  private removeReturnedRowLocally(row: CompletedLoanRowView): void {
    if (row.source === 'accessory') {
      this.accessoryReturns.update((list) =>
        list.filter(
          (acc) =>
            !(
              acc.orderId === row.loanId &&
              acc.loanedEquipmentId === row.loanedEquipmentId &&
              (acc.serialCode ?? '').trim() === row.item.serialCode.trim()
            )
        )
      );
    } else {
      this.loans.update((list) =>
        list.map((loan) => {
          if (loan.id !== row.loanId) {
            return loan;
          }
          return {
            ...loan,
            returnedAt: null,
            hebrewReturnedDisplay: null,
            items: loan.items.map((item) =>
              item.id === row.itemId
                ? {
                    ...item,
                    returnedAt: null,
                    hebrewReturnedDisplay: null,
                    chargeAmount: null,
                    chargeIsPaid: null,
                    customerDebtId: null
                  }
                : item
            )
          };
        })
      );
    }

    if (this.historyMode()) {
      this.historyRows.update((list) => list.filter((r) => r.rowKey !== row.rowKey));
    }
  }

  /** Remove every local row belonging to a permanently deleted loan. */
  private removeLoanLocally(loanId: number): void {
    this.loans.update((list) => list.filter((loan) => loan.id !== loanId));
    if (this.historyMode()) {
      this.historyRows.update((list) => list.filter((r) => r.loanId !== loanId));
    }
  }

  private markGroupedDebtsPaid(group: GroupedCompletedLoanRowView): void {
    const unpaid = group.members.filter(
      (m) =>
        m.chargeAmount != null &&
        m.chargeAmount > 0 &&
        m.chargeIsPaid !== true &&
        m.customerDebtId != null &&
        m.customerDebtId > 0
    );
    if (unpaid.length === 0) {
      return;
    }

    const primaryDebtId = unpaid[0].customerDebtId!;
    this.markingDebtId.set(primaryDebtId);
    forkJoin(unpaid.map((row) => this.data.markCustomerDebtPaid(row.customerDebtId!)))
      .pipe(finalize(() => this.markingDebtId.set(null)))
      .subscribe((results) => {
        if (!results.some((r) => !!r)) {
          return;
        }
        for (const row of unpaid) {
          this.applyPaidLocally(row);
        }
        this.ordersSync.notifyDebtChanged();
        this.toast.success('החוב סומן כשולם');
      });
  }

  /** Patch local state only — no full list reload. */
  private applyPaidLocally(row: CompletedLoanRowView): void {
    this.loans.update((list) =>
      list.map((loan) => ({
        ...loan,
        items: loan.items.map((item) =>
          item.id === row.itemId ? { ...item, chargeIsPaid: true } : item
        )
      }))
    );

    if (this.historyMode()) {
      this.historyRows.update((list) =>
        list.map((r) => (r.rowKey === row.rowKey ? { ...r, chargeIsPaid: true } : r))
      );
    }
  }

  /**
   * Collapse flat returned units into Active Loans–style rows:
   * same tool/accessory name + borrow date within the loan card → one row + all code badges.
   * Different borrow dates stay as separate rows (each with its own duration).
   */
  private groupCompletedLoanRows(rows: CompletedLoanRowView[]): GroupedCompletedLoanRowView[] {
    const groups = new Map<string, GroupedCompletedLoanRowView>();

    for (const row of rows) {
      const nameKey = (row.item.toolName ?? '').trim().toLowerCase();
      const borrowDay = this.toIsoDay(row.lentAt);
      const groupKey =
        row.source === 'accessory' && row.loanedEquipmentId != null && row.loanedEquipmentId > 0
          ? `accessory:${row.loanedEquipmentId}|day:${borrowDay}`
          : `tool:${nameKey}|day:${borrowDay}`;

      const existing = groups.get(groupKey);
      if (!existing) {
        const code = (row.item.serialCode ?? '').trim();
        groups.set(groupKey, {
          rowKey: `group:${groupKey}:${row.loanId}`,
          source: row.source,
          loanId: row.loanId,
          toolName: row.item.toolName,
          quantity: row.accessoryQuantity || 1,
          serialCodes: code ? [code] : [],
          members: [row],
          lentAt: row.lentAt,
          hebrewLentDisplay: row.hebrewLentDisplay,
          deadlineAt: row.deadlineAt,
          returnedAt: row.returnedAt,
          hebrewReturnedDisplay: row.hebrewReturnedDisplay,
          chargeAmount: row.chargeAmount,
          chargeIsPaid: row.chargeIsPaid,
          customerDebtId: row.customerDebtId
        });
        continue;
      }

      existing.quantity += row.accessoryQuantity || 1;
      existing.members.push(row);
      // Same calendar borrow day — keep earliest lend / latest return for duration display.
      if (row.lentAt.getTime() < existing.lentAt.getTime()) {
        existing.lentAt = row.lentAt;
        existing.hebrewLentDisplay = row.hebrewLentDisplay;
      }
      if (row.returnedAt.getTime() > existing.returnedAt.getTime()) {
        existing.returnedAt = row.returnedAt;
        existing.hebrewReturnedDisplay = row.hebrewReturnedDisplay;
      }
      if (
        row.deadlineAt &&
        (!existing.deadlineAt || row.deadlineAt.getTime() < existing.deadlineAt.getTime())
      ) {
        existing.deadlineAt = row.deadlineAt;
      }
      const code = (row.item.serialCode ?? '').trim();
      if (code && !existing.serialCodes.some((c) => c.toLowerCase() === code.toLowerCase())) {
        existing.serialCodes.push(code);
      }

      const chargeSum = existing.members.reduce((sum, m) => sum + (m.chargeAmount ?? 0), 0);
      existing.chargeAmount = chargeSum > 0 ? chargeSum : null;
      const unpaid = existing.members.filter(
        (m) => (m.chargeAmount ?? 0) > 0 && m.chargeIsPaid !== true
      );
      existing.chargeIsPaid =
        existing.chargeAmount == null
          ? null
          : unpaid.length === 0
            ? true
            : false;
      existing.customerDebtId =
        unpaid.find((m) => m.customerDebtId != null && m.customerDebtId > 0)?.customerDebtId ??
        null;
    }

    return [...groups.values()]
      .map((g) => ({
        ...g,
        serialCodes: sortNumericCodes(g.serialCodes)
      }))
      .sort(
        (a, b) =>
          b.lentAt.getTime() - a.lentAt.getTime() ||
          a.toolName.localeCompare(b.toolName, 'he')
      );
  }

  private toHistoryRow(h: ToolItemBorrowHistoryDto): CompletedLoanRowView | null {
    const loan = this.loans().find((l) => l.id === h.loanId);
    const lentAt = resolveLoanInstant(h.lentAt, loan?.lentAt);
    const returnedAt = resolveLoanInstant(h.returnedAt, lentAt);
    if (!lentAt || !returnedAt) {
      return null;
    }
    return {
      rowKey: `hist-${h.loanId}-${h.itemId}`,
      source: 'tools',
      loanId: h.loanId,
      itemId: h.itemId,
      loanedEquipmentId: null,
      accessoryQuantity: 1,
      customerDebtId: h.customerDebtId ?? null,
      item: { toolName: h.toolName, serialCode: h.serialCode },
      clientName: h.clientName,
      phone: h.phone,
      address: (h.address ?? '').trim(),
      deposit: (loan?.deposit ?? '').trim(),
      cashDepositAmount: loan?.cashDepositAmount ?? null,
      depositReturned: loan?.depositReturned === true,
      loanNotes: (loan?.notes ?? '').trim(),
      lentAt,
      hebrewLentDisplay: h.hebrewLentDisplay || this.formatHebrewDateTime(lentAt),
      deadlineAt: resolveLoanInstant(h.deadlineAt),
      returnedAt,
      hebrewReturnedDisplay:
        h.hebrewReturnedDisplay?.trim() || this.formatHebrewDateTime(returnedAt, true),
      chargeAmount: h.chargeAmount ?? null,
      chargeIsPaid: h.chargeIsPaid ?? null
    };
  }

  private buildActiveLoanRowViews(loans: ToolLoanDto[]): ActiveLoanRowView[] {
    const views: ActiveLoanRowView[] = [];
    for (const loan of loans) {
      const loanLentAt = resolveLoanInstant(loan.lentAt);
      const deadlineAt = resolveLoanInstant(loan.deadlineAt);
      for (const item of loan.items) {
        if (item.returnedAt) {
          continue;
        }
        const lentAt = resolveLoanInstant(item.addedAt, loanLentAt, loan.lentAt);
        if (!lentAt) {
          continue;
        }
        views.push({
          rowKey: `${loan.id}-${item.id}`,
          loanId: loan.id,
          itemId: item.id,
          item,
          clientName: loan.clientName,
          phone: loan.phone,
          address: (loan.address ?? '').trim(),
          lentAt,
          deadlineAt
        });
      }
    }
    return views.sort((a, b) => b.lentAt.getTime() - a.lentAt.getTime());
  }

  private buildQuickReturnItems(
    customerRows: ActiveLoanRowView[],
    match: ActiveLoanRowView,
    scannedCode: string
  ): QuickReturnItem[] {
    const items: QuickReturnItem[] = [];

    for (const row of customerRows) {
      if (row.itemId == null) {
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
        loanDateIso: this.toIsoDay(row.lentAt),
        hebrewDate,
        lentAt: row.lentAt,
        deadlineAt: row.deadlineAt,
        hebrewLentDisplay: this.formatHebrewDateTime(row.lentAt),
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

  private focusQuickReturnCodeInput(): void {
    const input = this.document.getElementById(
      'tools-returns-quick-return-code-input'
    ) as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }

  private formatHebrewDateTime(date: Date, withSeconds = false): string {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    if (withSeconds) {
      const ss = String(date.getSeconds()).padStart(2, '0');
      return `${this.hebrew.toHebrew(date)} ${hh}:${mm}:${ss}`;
    }
    return `${this.hebrew.toHebrew(date)} ${hh}:${mm}`;
  }
}
