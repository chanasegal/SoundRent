import { inject, Injectable, signal } from '@angular/core';
import { finalize, merge, Observable, of, Subscription, tap } from 'rxjs';

import { CashDepositDto } from '../models/cash-deposit.model';
import { formatCashAmount } from '../utils/cash-deposit';
import { DataService } from './data.service';
import { OrdersSyncService } from './orders-sync.service';
import { ToastService } from './toast.service';

/** Cached open list is reused for this long before a view triggers a background reload. */
const STALE_MS = 30_000;

/**
 * Open cash deposits across every workspace. Shared by the deposits page and the
 * return-time alerts so one request serves every customer card on screen.
 */
@Injectable({ providedIn: 'root' })
export class CashDepositsStore {
  private readonly data = inject(DataService);
  private readonly toast = inject(ToastService);

  private readonly openSignal = signal<CashDepositDto[]>([]);
  readonly openDeposits = this.openSignal.asReadonly();

  private readonly loadingSignal = signal(false);
  readonly loading = this.loadingSignal.asReadonly();

  private readonly loadedSignal = signal(false);
  /** True once the first list has arrived (distinguishes "empty" from "not loaded yet"). */
  readonly loaded = this.loadedSignal.asReadonly();

  private readonly markingIdSignal = signal<number | null>(null);
  readonly markingId = this.markingIdSignal.asReadonly();

  private readonly deletingIdSignal = signal<number | null>(null);
  readonly deletingId = this.deletingIdSignal.asReadonly();

  private lastLoadedAt = 0;
  private inFlight: Subscription | null = null;

  constructor() {
    // Saving a loan/order can create or change a deposit server-side.
    const ordersSync = inject(OrdersSyncService);
    merge(ordersSync.orderChanged$, ordersSync.loanChanged$).subscribe(() => {
      this.lastLoadedAt = 0;
      if (this.loadedSignal()) {
        this.refresh();
      }
    });
  }

  refresh(options?: { force?: boolean }): void {
    if (this.inFlight) {
      return;
    }
    if (!options?.force && Date.now() - this.lastLoadedAt < STALE_MS) {
      return;
    }

    this.loadingSignal.set(true);
    this.inFlight = this.data
      .getCashDeposits('Open', { background: true })
      .pipe(
        finalize(() => {
          this.inFlight = null;
          this.loadingSignal.set(false);
        })
      )
      .subscribe({
        next: (rows) => {
          this.openSignal.set(rows);
          this.lastLoadedAt = Date.now();
          this.loadedSignal.set(true);
        },
        // Background refresh: keep whatever is already on screen.
        error: () => undefined
      });
  }

  openForPhone(phone: string | null | undefined): CashDepositDto[] {
    const digits = CashDepositsStore.digitsOnly(phone);
    if (!digits) {
      return [];
    }
    return this.openSignal().filter((d) => CashDepositsStore.digitsOnly(d.phone) === digits);
  }

  /** Marks the deposit returned and drops it from the open list. Emits the updated row, or null. */
  markReturned(deposit: CashDepositDto): Observable<CashDepositDto | null> {
    if (this.markingIdSignal() != null || this.deletingIdSignal() != null) {
      return of(null);
    }

    this.markingIdSignal.set(deposit.id);
    return this.data.markCashDepositReturned(deposit.id).pipe(
      tap((updated) => {
        if (!updated) {
          return;
        }
        this.openSignal.update((rows) => rows.filter((d) => d.id !== deposit.id));
        this.toast.success(`הפיקדון בסך ${formatCashAmount(deposit.amount)} סומן כהוחזר`);
      }),
      finalize(() => this.markingIdSignal.set(null))
    );
  }

  /** Deletes the deposit ledger row and drops it from the open list. Emits true on success. */
  delete(deposit: CashDepositDto): Observable<boolean> {
    if (this.deletingIdSignal() != null || this.markingIdSignal() != null) {
      return of(false);
    }

    this.deletingIdSignal.set(deposit.id);
    return this.data.deleteCashDeposit(deposit.id).pipe(
      tap((ok) => {
        if (!ok) {
          return;
        }
        this.openSignal.update((rows) => rows.filter((d) => d.id !== deposit.id));
        this.toast.success(`הפיקדון בסך ${formatCashAmount(deposit.amount)} נמחק`);
      }),
      finalize(() => this.deletingIdSignal.set(null))
    );
  }

  private static digitsOnly(value: string | null | undefined): string {
    return (value ?? '').replace(/\D/g, '');
  }
}
