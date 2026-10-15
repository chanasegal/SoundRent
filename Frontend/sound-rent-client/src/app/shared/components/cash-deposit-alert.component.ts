import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';

import { CashDepositDto } from '../../core/models/cash-deposit.model';
import { CashDepositsStore } from '../../core/services/cash-deposits.store';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { formatCashAmount } from '../../core/utils/cash-deposit';

/**
 * Return-time warning: lists the customer's open cash deposits (from any workspace) with the
 * exact amount to hand back, and lets staff mark each one returned in place.
 * Renders nothing when the customer has no open deposit.
 */
@Component({
  selector: 'app-cash-deposit-alert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (deposits().length > 0) {
      <div
        class="mb-3 rounded-xl border-2 border-amber-400 bg-amber-50 p-3 text-amber-950 shadow-sm"
        role="alert"
        aria-live="polite"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400 text-base font-bold text-white" aria-hidden="true">₪</span>
          <p class="text-sm font-bold sm:text-base">
            ללקוח יש פיקדון במזומן פתוח — יש להחזיר
            <span class="mx-1 rounded bg-amber-200 px-1.5 py-0.5 text-lg font-extrabold" dir="ltr">{{ formatAmount(total()) }}</span>
          </p>
        </div>
        <ul class="mt-2 space-y-1.5">
          @for (deposit of deposits(); track deposit.id) {
            <li class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-sm">
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
                    [disabled]="store.markingId() != null"
                    (click)="markReturned(deposit)"
                  >
                    {{ store.markingId() === deposit.id ? 'מעדכן…' : 'אישור: ' + formatAmount(deposit.amount) + ' הוחזר' }}
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
                  [disabled]="store.markingId() != null"
                  (click)="confirmingId.set(deposit.id)"
                >
                  סמן כהוחזר
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
  private readonly hebrew = inject(HebrewDateService);

  readonly phone = input<string | null | undefined>(null);

  protected readonly confirmingId = signal<number | null>(null);
  protected readonly deposits = computed(() => this.store.openForPhone(this.phone()));
  protected readonly total = computed(() =>
    this.deposits().reduce((sum, d) => sum + Number(d.amount || 0), 0)
  );

  ngOnInit(): void {
    this.store.refresh();
  }

  protected markReturned(deposit: CashDepositDto): void {
    this.store.markReturned(deposit).subscribe(() => this.confirmingId.set(null));
  }

  protected formatAmount(amount: number): string {
    return formatCashAmount(amount);
  }

  protected formatDate(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : this.hebrew.toHebrew(date);
  }
}
