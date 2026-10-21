import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { ConfirmPopup } from 'primeng/confirmpopup';
import { finalize } from 'rxjs';

import { CashDepositDto } from '../../core/models/cash-deposit.model';
import { SYSTEM_TYPE_OPTIONS, SystemType } from '../../core/models/enums';
import { CashDepositsStore } from '../../core/services/cash-deposits.store';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { OrdersSyncService } from '../../core/services/orders-sync.service';
import { formatCashAmount } from '../../core/utils/cash-deposit';
import { startLiveDataRefresh } from '../../core/utils/live-data-refresh';

type DepositsTab = 'open' | 'returned';

const MODULE_LABELS: Record<SystemType, string> = {
  [SystemType.Sound]: 'הגברה',
  [SystemType.Tools]: 'כלי עבודה',
  [SystemType.Library]: 'ספרייה'
};

/** Cross-workspace cash deposits ledger ("פקדונות"), mounted under every workspace shell. */
@Component({
  selector: 'app-cash-deposits',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConfirmPopup],
  providers: [ConfirmationService],
  styleUrl: './cash-deposits.component.scss',
  template: `
    <div class="mx-auto max-w-6xl px-4 py-6">
      <p-confirmpopup />

      <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold text-[#002244]">פקדונות</h1>
          <p class="mt-1 text-sm text-slate-600">
            פקדונות במזומן מכל המערכות (הגברה, כלי עבודה, ספרייה). סמנו פיקדון כהוחזר ברגע שהכסף הוחזר ללקוח.
          </p>
        </div>
        <button
          type="button"
          class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          [disabled]="isLoading()"
          (click)="reload()"
        >
          {{ isLoading() ? 'טוען…' : 'רענון' }}
        </button>
      </div>

      @if (tab() === 'open') {
        <div class="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
            <p class="text-sm font-medium text-amber-800">סה״כ מזומן מוחזק</p>
            <p class="mt-1 text-2xl font-bold text-amber-900" dir="ltr">{{ formatAmount(openTotal()) }}</p>
          </div>
          <div class="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <p class="text-sm font-medium text-slate-600">פקדונות פתוחים</p>
            <p class="mt-1 text-2xl font-bold text-[#002244]">{{ store.openDeposits().length }}</p>
          </div>
        </div>
      }

      <div class="mb-4 inline-flex overflow-hidden rounded-lg border border-slate-300 bg-white text-sm font-medium" role="tablist">
        <button
          type="button"
          role="tab"
          class="px-4 py-2 transition-colors"
          [class]="tab() === 'open' ? activeTabClass : inactiveTabClass"
          [attr.aria-selected]="tab() === 'open'"
          (click)="setTab('open')"
        >
          פתוחים
        </button>
        <button
          type="button"
          role="tab"
          class="border-s border-slate-300 px-4 py-2 transition-colors"
          [class]="tab() === 'returned' ? activeTabClass : inactiveTabClass"
          [attr.aria-selected]="tab() === 'returned'"
          (click)="setTab('returned')"
        >
          הוחזרו
        </button>
      </div>

      <section class="mb-5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div class="flex flex-wrap items-end gap-3">
          <label class="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
            חיפוש
            <input
              type="search"
              class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal"
              placeholder="שם לקוח / טלפון / מספר הזמנה…"
              autocomplete="off"
              [value]="query()"
              (input)="query.set($any($event.target).value)"
            />
          </label>
          <label class="flex flex-col gap-1 text-sm font-medium text-slate-700">
            מערכת
            <select
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal"
              [value]="moduleFilter()"
              (change)="moduleFilter.set($any($event.target).value)"
            >
              <option value="">הכל</option>
              @for (m of moduleOptions; track m) {
                <option [value]="m">{{ moduleLabels[m] }}</option>
              }
            </select>
          </label>
          @if (query() || moduleFilter()) {
            <button
              type="button"
              class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              (click)="clearFilters()"
            >
              נקה
            </button>
          }
        </div>
      </section>

      <section class="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        @if (isLoading() && filteredRows().length === 0) {
          <p class="p-6 text-center text-sm text-slate-500">טוען פקדונות…</p>
        } @else if (filteredRows().length === 0) {
          <p class="p-6 text-center text-sm text-slate-500">
            @if (query() || moduleFilter()) {
              לא נמצאו פקדונות תואמים לחיפוש
            } @else if (tab() === 'open') {
              אין פקדונות פתוחים
            } @else {
              אין פקדונות שהוחזרו
            }
          </p>
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full border-collapse text-right text-sm">
              <thead>
                <tr class="border-b border-slate-200 bg-slate-50 text-slate-700">
                  <th class="px-3 py-2 font-semibold">לקוח</th>
                  <th class="px-3 py-2 font-semibold">טלפון</th>
                  <th class="px-3 py-2 font-semibold">כתובת</th>
                  <th class="px-3 py-2 font-semibold">סכום</th>
                  <th class="px-3 py-2 font-semibold">התקבל</th>
                  <th class="px-3 py-2 font-semibold">מערכת</th>
                  <th class="px-3 py-2 font-semibold">הזמנה</th>
                  <th class="px-3 py-2 font-semibold">הערות</th>
                  @if (tab() === 'returned') {
                    <th class="px-3 py-2 text-center font-semibold">הוחזר</th>
                  }
                  <th class="px-3 py-2 text-center font-semibold">פעולה</th>
                </tr>
              </thead>
              <tbody>
                @for (row of filteredRows(); track row.id) {
                  <tr class="border-b border-slate-100 hover:bg-slate-50/80">
                    <td class="px-3 py-2 font-medium text-slate-900">{{ row.customerName || 'ללא שם' }}</td>
                    <td class="px-3 py-2 font-mono text-xs" dir="ltr">{{ formatPhone(row.phone) }}</td>
                    <td class="max-w-[12rem] truncate px-3 py-2" [title]="row.address || ''">{{ row.address || '—' }}</td>
                    <td class="whitespace-nowrap px-3 py-2 font-bold text-amber-800" dir="ltr">{{ formatAmount(row.amount) }}</td>
                    <td class="whitespace-nowrap px-3 py-2 text-slate-600">{{ formatDate(row.receivedAt) }}</td>
                    <td class="whitespace-nowrap px-3 py-2">{{ moduleLabels[row.sourceModule] || row.sourceModuleLabel }}</td>
                    <td class="whitespace-nowrap px-3 py-2 text-slate-600">{{ row.sourceReference || '—' }}</td>
                    <td class="max-w-[14rem] truncate px-3 py-2 text-slate-600" [title]="row.notes || ''">{{ row.notes || '—' }}</td>
                    @if (tab() === 'returned') {
                      <td class="whitespace-nowrap px-3 py-2 text-center text-xs text-slate-600">
                        {{ row.returnedAt ? formatDate(row.returnedAt) : '—' }}
                      </td>
                    }
                    <td class="whitespace-nowrap px-3 py-2 text-center">
                      <div class="inline-flex items-center justify-center gap-2">
                        @if (tab() === 'open') {
                          <button
                            type="button"
                            class="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
                            [disabled]="store.markingId() != null || store.deletingId() != null"
                            (click)="confirmMarkReturned($event, row)"
                          >
                            {{ store.markingId() === row.id ? 'מעדכן…' : 'סמן כהוחזר' }}
                          </button>
                        }
                        <button
                          type="button"
                          class="recent-loan-action recent-loan-action--delete"
                          [disabled]="store.deletingId() != null || store.markingId() != null"
                          title="מחיקת פיקדון"
                          aria-label="מחיקת פיקדון"
                          (click)="confirmDelete($event, row)"
                        >
                          @if (store.deletingId() === row.id) {
                            …
                          } @else {
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M4 7h16"></path>
                              <path d="M10 11v6"></path>
                              <path d="M14 11v6"></path>
                              <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"></path>
                              <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
                            </svg>
                          }
                        </button>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>
    </div>
  `
})
export class CashDepositsComponent implements OnInit {
  protected readonly store = inject(CashDepositsStore);
  private readonly data = inject(DataService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly ordersSync = inject(OrdersSyncService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly moduleOptions = SYSTEM_TYPE_OPTIONS;
  protected readonly moduleLabels = MODULE_LABELS;
  protected readonly activeTabClass = 'bg-[#002244] text-white';
  protected readonly inactiveTabClass = 'text-slate-700 hover:bg-slate-50';

  protected readonly tab = signal<DepositsTab>('open');
  protected readonly query = signal('');
  protected readonly moduleFilter = signal<SystemType | ''>('');
  protected readonly returnedRows = signal<CashDepositDto[]>([]);
  private readonly returnedLoading = signal(false);

  protected readonly isLoading = computed(() =>
    this.tab() === 'open' ? this.store.loading() : this.returnedLoading()
  );

  protected readonly openTotal = computed(() =>
    this.store.openDeposits().reduce((sum, d) => sum + Number(d.amount || 0), 0)
  );

  protected readonly filteredRows = computed(() => {
    const rows = this.tab() === 'open' ? this.store.openDeposits() : this.returnedRows();
    const module = this.moduleFilter();
    const raw = this.query().trim().toLowerCase();
    const digits = raw.replace(/\D/g, '');
    return rows.filter((row) => {
      if (module && row.sourceModule !== module) {
        return false;
      }
      if (!raw) {
        return true;
      }
      if ((row.customerName ?? '').toLowerCase().includes(raw)) {
        return true;
      }
      if (!digits) {
        return false;
      }
      if (row.phone.replace(/\D/g, '').includes(digits)) {
        return true;
      }
      const refs = [row.orderId, row.toolLoanId, row.bookLoanId].filter((id) => id != null);
      return refs.some((id) => String(id) === digits);
    });
  });

  ngOnInit(): void {
    const phone = this.route.snapshot.queryParamMap.get('phone');
    if (phone) {
      this.query.set(phone);
    }
    this.store.refresh({ force: true });
    startLiveDataRefresh(this.destroyRef, () => this.reload(), {
      skipWhen: () => this.store.markingId() != null || this.store.deletingId() != null
    });
  }

  protected setTab(tab: DepositsTab): void {
    if (this.tab() === tab) {
      return;
    }
    this.tab.set(tab);
    this.reload();
  }

  protected reload(): void {
    if (this.tab() === 'open') {
      this.store.refresh({ force: true });
      return;
    }
    this.returnedLoading.set(true);
    this.data
      .getCashDeposits('Returned', { background: true })
      .pipe(finalize(() => this.returnedLoading.set(false)))
      .subscribe((rows) => this.returnedRows.set(rows));
  }

  protected clearFilters(): void {
    this.query.set('');
    this.moduleFilter.set('');
  }

  protected confirmMarkReturned(event: Event, row: CashDepositDto): void {
    const name = row.customerName.trim() || 'הלקוח';
    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message: `לסמן שהפיקדון בסך ${formatCashAmount(row.amount)} הוחזר ל${name}?`,
      acceptLabel: 'כן, הוחזר',
      rejectLabel: 'ביטול',
      acceptButtonStyleClass: 'p-button-sm p-button-success',
      rejectButtonStyleClass: 'p-button-sm p-button-outlined',
      accept: () => this.store.markReturned(row).subscribe()
    });
  }

  protected confirmDelete(event: Event, row: CashDepositDto): void {
    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message: 'האם אתה בטוח שברצונך למחוק פיקדון זה?',
      acceptLabel: 'מחק',
      rejectLabel: 'ביטול',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-sm p-button-outlined',
      accept: () => {
        this.store.delete(row).subscribe((ok) => {
          if (!ok) {
            return;
          }
          this.returnedRows.update((rows) => rows.filter((d) => d.id !== row.id));
          this.ordersSync.notifyLoanChanged();
        });
      }
    });
  }

  protected formatAmount(amount: number): string {
    return formatCashAmount(amount);
  }

  protected formatDate(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '—' : this.hebrew.formatHebrewDateTime(date);
  }

  protected formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    return digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}` : phone;
  }
}
