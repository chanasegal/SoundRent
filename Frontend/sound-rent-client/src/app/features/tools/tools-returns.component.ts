import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  isDevMode,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { ConfirmPopup } from 'primeng/confirmpopup';
import { finalize } from 'rxjs/operators';

import {
  ToolItemBorrowHistoryDto,
  ToolLoanDto,
  ToolLoanItemDto
} from '../../core/models/tools-workspace.model';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToolDefinitionsStore } from '../../core/services/tool-definitions.store';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import {
  formatCalendarDuration,
  isNonBillableDay
} from '../../core/utils/tools-billable-duration';
import { LoanRangeCalendarHostComponent } from '../../shared/components/loan-range-calendar-host.component';
import { ToolTypeSelectComponent } from '../../shared/components/tool-type-select.component';

interface CompletedLoanRowView {
  rowKey: string;
  loanId: number;
  itemId: number;
  customerDebtId: number | null;
  item: Pick<ToolLoanItemDto, 'toolName' | 'serialCode'>;
  clientName: string;
  phone: string;
  lentAt: Date;
  hebrewLentDisplay: string;
  deadlineAt: Date | null;
  returnedAt: Date;
  hebrewReturnedDisplay: string;
  chargeAmount: number | null;
  chargeIsPaid: boolean | null;
}

@Component({
  selector: 'app-tools-returns',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    ToolTypeSelectComponent,
    LoanRangeCalendarHostComponent,
    ConfirmPopup
  ],
  providers: [ConfirmationService],
  templateUrl: './tools-returns.component.html',
  styleUrl: './tools-returns.component.scss'
})
export class ToolsReturnsComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly toolStore = inject(ToolDefinitionsStore);
  private readonly hebrew = inject(HebrewDateService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);
  protected readonly pageTitle = inject(WorkspaceUiService).title('החזרות');

  protected readonly loading = signal(true);
  protected readonly loans = signal<ToolLoanDto[]>([]);
  protected readonly definitions = this.toolStore.definitions;
  protected readonly markingDebtId = signal<number | null>(null);
  protected readonly undoingRowKey = signal<string | null>(null);
  protected readonly deletingLoanId = signal<number | null>(null);

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
    return [...(def?.serialCodes ?? [])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  });

  protected readonly allCompletedRows = computed(() => {
    const views: CompletedLoanRowView[] = [];

    for (const loan of this.loans()) {
      const lentAt = new Date(loan.lentAt);
      const deadlineAt = loan.deadlineAt ? new Date(loan.deadlineAt) : null;

      for (const item of loan.items) {
        if (!item.returnedAt) {
          continue;
        }
        const returnedAt = new Date(item.returnedAt);
        views.push({
          rowKey: `${loan.id}-${item.id}`,
          loanId: loan.id,
          itemId: item.id,
          customerDebtId: item.customerDebtId ?? null,
          item,
          clientName: loan.clientName,
          phone: loan.phone,
          lentAt,
          hebrewLentDisplay: loan.hebrewLentDisplay || this.formatHebrewDateTime(lentAt),
          deadlineAt,
          returnedAt,
          hebrewReturnedDisplay:
            item.hebrewReturnedDisplay?.trim() || this.formatHebrewDateTime(returnedAt, true),
          chargeAmount: item.chargeAmount ?? null,
          chargeIsPaid: item.chargeIsPaid ?? null
        });
      }
    }

    return views.sort((a, b) => b.returnedAt.getTime() - a.returnedAt.getTime());
  });

  protected readonly rows = computed(() =>
    this.historyMode() ? this.historyRows() : this.allCompletedRows()
  );

  ngOnInit(): void {
    this.toolStore.load().subscribe();
    this.refresh();

    if (isDevMode()) {
      (window as unknown as Record<string, unknown>)['debugReturns'] = (loanId: number) =>
        this.debugLoanCalculation(loanId);
      console.info(
        '[tools-returns] Debug helper ready — run debugReturns(<loanId>) in the console.'
      );
    }
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
    this.data
      .getToolLoans()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe((list) => {
        this.loans.set(list);
      });
  }

  protected onHistoryToolChange(toolId: number | null): void {
    this.historyToolId.set(toolId != null && toolId > 0 ? toolId : null);
    this.historyCode.set('');
  }

  protected onHistoryCodeInput(value: string): void {
    this.historyCode.set(value);
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
        this.historyRows.set(list.map((h) => this.toHistoryRow(h)));
        this.historyMode.set(true);
      });
  }

  protected clearHistorySearch(): void {
    this.historyMode.set(false);
    this.historyRows.set([]);
    this.historyToolId.set(null);
    this.historyCode.set('');
  }

  protected formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
  }

  protected formatDeadline(deadline: Date | null): string {
    if (!deadline) {
      return '—';
    }
    const hh = String(deadline.getHours()).padStart(2, '0');
    const mm = String(deadline.getMinutes()).padStart(2, '0');
    return `${this.hebrew.toHebrew(deadline)} ${hh}:${mm}`;
  }

  protected durationText(row: CompletedLoanRowView): string {
    return formatCalendarDuration(row.lentAt, row.returnedAt);
  }

  /** Local `YYYY-MM-DD` — built from local Y/M/D so no UTC/TZ day-shift occurs. */
  private toIsoDay(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
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

  protected isOverdue(row: CompletedLoanRowView): boolean {
    if (!row.deadlineAt) {
      return false;
    }
    return row.returnedAt.getTime() > row.deadlineAt.getTime();
  }

  protected formatCharge(amount: number | null): string {
    if (amount == null || amount <= 0) {
      return '—';
    }
    return `${amount} ₪`;
  }

  protected hasCharge(row: CompletedLoanRowView): boolean {
    return row.chargeAmount != null && row.chargeAmount > 0;
  }

  protected canQuickPay(row: CompletedLoanRowView): boolean {
    return (
      this.hasCharge(row) &&
      row.chargeIsPaid !== true &&
      row.customerDebtId != null &&
      row.customerDebtId > 0
    );
  }

  protected onOpenBadgeClick(event: Event, row: CompletedLoanRowView): void {
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
      accept: () => this.markDebtPaid(row)
    });
  }

  protected onUndoReturnClick(event: Event, row: CompletedLoanRowView): void {
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
      accept: () => this.undoReturn(row)
    });
  }

  protected onDeleteLoanClick(event: Event, row: CompletedLoanRowView): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.undoingRowKey() != null || this.deletingLoanId() != null) {
      return;
    }

    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message:
        'האם למחוק לחלוטין את רשומת ההשאלה הזו מהמערכת? (פעולה זו בלתי הפיכה ותמחק גם חובות קשורים)',
      acceptLabel: 'מחק',
      rejectLabel: 'ביטול',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-sm p-button-outlined',
      accept: () => this.deleteLoan(row)
    });
  }

  private undoReturn(row: CompletedLoanRowView): void {
    this.undoingRowKey.set(row.rowKey);
    this.data
      .undoToolLoanItemReturn(row.loanId, row.itemId)
      .pipe(finalize(() => this.undoingRowKey.set(null)))
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.removeReturnedRowLocally(row);
        this.toast.success('ההחזרה בוטלה — הפריט חזר להשאלות פעילות');
      });
  }

  private deleteLoan(row: CompletedLoanRowView): void {
    this.deletingLoanId.set(row.loanId);
    this.data
      .deleteToolLoan(row.loanId)
      .pipe(finalize(() => this.deletingLoanId.set(null)))
      .subscribe((ok) => {
        if (!ok) {
          return;
        }
        this.removeLoanLocally(row.loanId);
        this.toast.success('רשומת ההשאלה נמחקה');
      });
  }

  /** Drop the undone item from local lists without a full reload. */
  private removeReturnedRowLocally(row: CompletedLoanRowView): void {
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

  private markDebtPaid(row: CompletedLoanRowView): void {
    const debtId = row.customerDebtId;
    if (debtId == null) {
      return;
    }
    this.markingDebtId.set(debtId);
    this.data
      .markCustomerDebtPaid(debtId)
      .pipe(finalize(() => this.markingDebtId.set(null)))
      .subscribe((ok) => {
        if (!ok) {
          return;
        }
        this.applyPaidLocally(row);
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

  private toHistoryRow(h: ToolItemBorrowHistoryDto): CompletedLoanRowView {
    const lentAt = new Date(h.lentAt);
    const returnedAt = new Date(h.returnedAt);
    return {
      rowKey: `hist-${h.loanId}-${h.itemId}`,
      loanId: h.loanId,
      itemId: h.itemId,
      customerDebtId: h.customerDebtId ?? null,
      item: { toolName: h.toolName, serialCode: h.serialCode },
      clientName: h.clientName,
      phone: h.phone,
      lentAt,
      hebrewLentDisplay: h.hebrewLentDisplay || this.formatHebrewDateTime(lentAt),
      deadlineAt: h.deadlineAt ? new Date(h.deadlineAt) : null,
      returnedAt,
      hebrewReturnedDisplay:
        h.hebrewReturnedDisplay?.trim() || this.formatHebrewDateTime(returnedAt, true),
      chargeAmount: h.chargeAmount ?? null,
      chargeIsPaid: h.chargeIsPaid ?? null
    };
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
