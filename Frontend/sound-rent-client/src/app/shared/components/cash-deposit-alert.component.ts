import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';

import { CashDepositDto } from '../../core/models/cash-deposit.model';
import { CashDepositsStore } from '../../core/services/cash-deposits.store';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { OrdersSyncService } from '../../core/services/orders-sync.service';
import { ToastService } from '../../core/services/toast.service';
import { formatCashAmount } from '../../core/utils/cash-deposit';

/**
 * Return-time warning: lists the customer's open cash deposits (from any workspace) with the
 * exact amount to hand back, and lets staff mark each one returned in place.
 *
 * Optional source inputs (order / tool loan / book loan) show a per-loan cash-deposit banner
 * with "סימון שהוחזר פיקדון" / green "פיקדון הוחזר" badge.
 */
@Component({
  selector: 'app-cash-deposit-alert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (sourceReturned()) {
      <div
        class="mb-3 rounded-xl border-2 border-emerald-400 bg-emerald-50 p-3 text-emerald-950 shadow-sm"
        role="status"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span
            class="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-sm font-semibold text-emerald-800"
          >
            פיקדון הוחזר
          </span>
          <label class="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-emerald-900">
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-emerald-300 text-emerald-600 focus:ring-emerald-500"
              [checked]="true"
              [disabled]="toggling()"
              (change)="toggleSourceReturned($any($event.target).checked)"
            />
            הפקדון הוחזר
          </label>
        </div>
      </div>
    } @else if (hasSourceCash()) {
      <div
        class="mb-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-amber-950 shadow-sm"
        role="status"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm font-bold">
            פיקדון במזומן
            @if (cashDepositAmount(); as amount) {
              <span class="mx-1 rounded bg-amber-200 px-1.5 py-0.5 font-extrabold" dir="ltr">{{
                formatAmount(amount)
              }}</span>
            }
          </p>
          <label
            class="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-700"
          >
            <input
              type="checkbox"
              class="h-3.5 w-3.5 rounded border-amber-200"
              [checked]="false"
              [disabled]="toggling()"
              (change)="toggleSourceReturned(true)"
            />
            סימון שהוחזר פיקדון
          </label>
        </div>
      </div>
    }

    @if (otherOpenDeposits().length > 0) {
      <div
        class="mb-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-amber-950 shadow-sm"
        role="alert"
        aria-live="polite"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 text-base font-bold text-white"
            aria-hidden="true"
            >₪</span
          >
          <p class="text-sm font-bold sm:text-base">
            ללקוח יש פיקדון במזומן פתוח — יש להחזיר
            <span class="mx-1 rounded bg-amber-200 px-1.5 py-0.5 text-lg font-extrabold" dir="ltr">{{
              formatAmount(otherOpenTotal())
            }}</span>
          </p>
        </div>
        <ul class="mt-2 space-y-1.5">
          @for (deposit of otherOpenDeposits(); track deposit.id) {
            <li
              class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-sm"
            >
              <span class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <strong dir="ltr">{{ formatAmount(deposit.amount) }}</strong>
                <span class="text-amber-900/80">· {{ deposit.sourceModuleLabel }}</span>
                @if (deposit.sourceReference) {
                  <span class="text-amber-900/80">· {{ deposit.sourceReference }}</span>
                }
                <span class="text-amber-900/80">· התקבל {{ formatDate(deposit.receivedAt) }}</span>
              </span>
              @if (confirmingId() === deposit.id) {
                <span class="flex items-center gap-1.5">
                  <button
                    type="button"
                    class="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                    [disabled]="store.markingId() != null || toggling()"
                    (click)="markReturned(deposit)"
                  >
                    {{
                      store.markingId() === deposit.id
                        ? 'מעדכן…'
                        : 'אישור: ' + formatAmount(deposit.amount) + ' הוחזר'
                    }}
                  </button>
                  <button
                    type="button"
                    class="rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                    [disabled]="store.markingId() === deposit.id"
                    (click)="confirmingId.set(null)"
                  >
                    ביטול
                  </button>
                </span>
              } @else {
                <button
                  type="button"
                  class="rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-amber-700 disabled:opacity-50"
                  [disabled]="store.markingId() != null || toggling()"
                  (click)="confirmingId.set(deposit.id)"
                >
                  סימון שהוחזר פיקדון
                </button>
              }
            </li>
          }
        </ul>
      </div>
    }
  `
})
export class CashDepositAlertComponent implements OnInit {
  protected readonly store = inject(CashDepositsStore);
  private readonly data = inject(DataService);
  private readonly toast = inject(ToastService);
  private readonly ordersSync = inject(OrdersSyncService);
  private readonly hebrew = inject(HebrewDateService);

  readonly phone = input<string | null | undefined>(null);
  /** When set, enables per-source returned toggle / green badge for this loan/order. */
  readonly orderId = input<number | null>(null);
  readonly toolLoanId = input<number | null>(null);
  readonly bookLoanId = input<number | null>(null);
  readonly cashDepositAmount = input<number | null>(null);
  readonly depositReturned = input<boolean>(false);

  protected readonly confirmingId = signal<number | null>(null);
  protected readonly toggling = signal(false);
  protected readonly localReturned = signal<boolean | null>(null);

  protected readonly deposits = computed(() => this.store.openForPhone(this.phone()));

  /** Open deposits for this phone, excluding the one already shown via the per-source toggle. */
  protected readonly otherOpenDeposits = computed(() => {
    const all = this.deposits();
    if (!this.hasSourceCash()) {
      return all;
    }
    return all.filter((d) => !this.matchesSource(d));
  });

  protected readonly otherOpenTotal = computed(() =>
    this.otherOpenDeposits().reduce((sum, d) => sum + Number(d.amount || 0), 0)
  );

  protected readonly hasSourceCash = computed(() => {
    const amount = this.cashDepositAmount();
    return (
      (this.orderId() != null || this.toolLoanId() != null || this.bookLoanId() != null) &&
      amount != null &&
      Number(amount) > 0
    );
  });

  protected readonly sourceReturned = computed(() => {
    if (!this.hasSourceCash()) {
      return false;
    }
    const local = this.localReturned();
    return local != null ? local : this.depositReturned() === true;
  });

  ngOnInit(): void {
    this.store.refresh();
  }

  protected markReturned(deposit: CashDepositDto): void {
    this.store.markReturned(deposit).subscribe((updated) => {
      this.confirmingId.set(null);
      if (updated && this.matchesSource(updated)) {
        this.localReturned.set(true);
        this.ordersSync.notifyLoanChanged();
      }
    });
  }

  protected toggleSourceReturned(returned: boolean): void {
    const payload = {
      orderId: this.orderId() ?? undefined,
      toolLoanId: this.toolLoanId() ?? undefined,
      bookLoanId: this.bookLoanId() ?? undefined,
      returned
    };
    if (
      !(payload.orderId != null && payload.orderId > 0) &&
      !(payload.toolLoanId != null && payload.toolLoanId > 0) &&
      !(payload.bookLoanId != null && payload.bookLoanId > 0)
    ) {
      return;
    }

    this.toggling.set(true);
    this.data.setDepositReturned(payload).subscribe((result) => {
      this.toggling.set(false);
      if (!result) {
        return;
      }
      this.localReturned.set(result.depositReturned);
      this.store.refresh({ force: true });
      this.ordersSync.notifyLoanChanged();
      this.toast.success(
        result.depositReturned ? 'הפיקדון סומן כהוחזר' : 'סימון החזרת הפיקדון בוטל'
      );
    });
  }

  protected formatAmount(amount: number): string {
    return formatCashAmount(amount);
  }

  protected formatDate(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : this.hebrew.toHebrew(date);
  }

  private matchesSource(deposit: CashDepositDto): boolean {
    const orderId = this.orderId();
    const toolLoanId = this.toolLoanId();
    const bookLoanId = this.bookLoanId();
    return (
      (orderId != null && deposit.orderId === orderId) ||
      (toolLoanId != null && deposit.toolLoanId === toolLoanId) ||
      (bookLoanId != null && deposit.bookLoanId === bookLoanId)
    );
  }
}
