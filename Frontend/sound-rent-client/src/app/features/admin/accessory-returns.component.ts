import { CommonModule } from '@angular/common';
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
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  debounceTime,
  distinctUntilChanged,
  finalize,
  forkJoin,
  of,
  startWith,
  switchMap
} from 'rxjs';

import { DEPOSIT_TYPE_LABELS } from '../../core/models/enums';
import { ReturnedAccessoryHistoryDto } from '../../core/models/equipment-return.model';
import { CustomersStore } from '../../core/services/customers.store';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { OrdersSyncService } from '../../core/services/orders-sync.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import { startLiveDataRefresh } from '../../core/utils/live-data-refresh';
import { sortNumericCodes } from '../../core/utils/numeric-code-sort';
import { CashDepositAlertComponent } from '../../shared/components/cash-deposit-alert.component';

interface ReturnedAccessoryRow extends ReturnedAccessoryHistoryDto {
  rowKey: string;
}

/** Same item name + borrow date within a return card — mirrors active-loans grouped rows. */
interface GroupedReturnedAccessoryRow {
  rowKey: string;
  itemName: string;
  quantity: number;
  serialCodes: string[];
  isCustomItem: boolean;
  /** yyyy-MM-dd borrow date for this grouped row. */
  loanDate: string | null;
  members: ReturnedAccessoryRow[];
}

/** One card per customer + order, mirroring the active-loans page's customer cards. */
interface ReturnedOrderCard {
  key: string;
  /** Representative row for order label/link helpers. */
  head: ReturnedAccessoryRow;
  customerName: string;
  phone: string;
  address: string;
  loanDate: string | null;
  returnDate: string | null;
  deposit: string;
  loanNotes: string;
  customerNotes: string | null;
  totalQuantity: number;
  items: GroupedReturnedAccessoryRow[];
}

@Component({
  selector: 'app-accessory-returns',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, CashDepositAlertComponent],
  templateUrl: './accessory-returns.component.html',
  styleUrl: './accessory-returns.component.scss'
})
export class AccessoryReturnsComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly customers = inject(CustomersStore);
  private readonly hebrew = inject(HebrewDateService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ordersSync = inject(OrdersSyncService);
  protected readonly pageTitle = inject(WorkspaceUiService).title('החזרות');

  protected readonly loading = signal(false);
  protected readonly rows = signal<ReturnedAccessoryRow[]>([]);
  protected readonly appliedQuery = signal('');
  protected readonly undoingRowKey = signal<string | null>(null);
  protected readonly deletingRowKey = signal<string | null>(null);

  protected readonly searchControl = new FormControl('', { nonNullable: true });

  protected readonly hasActiveSearch = computed(() => this.appliedQuery().trim().length > 0);

  protected readonly actionsBusy = computed(
    () => this.undoingRowKey() != null || this.deletingRowKey() != null
  );

  protected readonly returnedCards = computed(() => {
    this.customers.customers();
    const byOrder = new Map<
      string,
      Omit<ReturnedOrderCard, 'items'> & { rawItems: ReturnedAccessoryRow[] }
    >();

    for (const row of this.rows()) {
      const phoneKey = (row.phone ?? '').replace(/\D/g, '');
      const key = `${row.orderId}|${(row.customerName ?? '').trim()}|${phoneKey}`;
      let card = byOrder.get(key);
      if (!card) {
        card = {
          key,
          head: row,
          customerName: (row.customerName ?? '').trim(),
          phone: row.phone,
          address: (row.address ?? '').trim(),
          loanDate: row.loanDate ?? null,
          returnDate: row.returnDate ?? null,
          deposit: this.formatDeposit(row),
          loanNotes: (row.notes ?? '').trim(),
          customerNotes: this.customers.notesForPhone(row.phone),
          totalQuantity: 0,
          rawItems: []
        };
        byOrder.set(key, card);
      }
      if (row.loanDate && (!card.loanDate || row.loanDate < card.loanDate)) {
        card.loanDate = row.loanDate;
      }
      if (row.returnDate && (!card.returnDate || row.returnDate > card.returnDate)) {
        card.returnDate = row.returnDate;
      }
      if (!card.address && row.address) {
        card.address = row.address.trim();
      }
      card.totalQuantity += row.quantity;
      card.rawItems.push(row);
    }

    return [...byOrder.values()]
      .map(
        ({ rawItems, ...rest }): ReturnedOrderCard => ({
          ...rest,
          items: this.groupReturnedAccessoryRows(rawItems)
        })
      )
      .sort(
        (a, b) =>
          (b.returnDate ?? '').localeCompare(a.returnDate ?? '') || b.head.orderId - a.head.orderId
      );
  });

  ngOnInit(): void {
    this.customers.load().subscribe();
    this.searchControl.valueChanges
      .pipe(
        startWith(this.searchControl.value),
        debounceTime(280),
        distinctUntilChanged(),
        switchMap((raw) => {
          const q = raw.trim();
          this.loading.set(true);
          this.appliedQuery.set(q);
          return this.data.getReturnedAccessories(q || null).pipe(
            finalize(() => this.loading.set(false))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((items) => this.rows.set(this.mapRows(items)));

    // Returns recorded from Tools or Active Loans should appear here without a
    // manual refresh, using the shared order-mutation broadcast.
    this.ordersSync.orderChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refresh());
    this.ordersSync.loanChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refresh());
    this.ordersSync.unreturnedChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.refresh());

    startLiveDataRefresh(this.destroyRef, () => this.refresh(), {
      skipWhen: () => this.loading() || this.actionsBusy()
    });
  }

  protected refresh(): void {
    const q = this.searchControl.value.trim();
    this.loading.set(true);
    this.appliedQuery.set(q);
    this.data
      .getReturnedAccessories(q || null)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe((items) => this.rows.set(this.mapRows(items)));
  }

  protected clearSearch(): void {
    if (!this.searchControl.value) {
      return;
    }
    this.searchControl.setValue('');
  }

  protected undoReturn(group: GroupedReturnedAccessoryRow): void {
    if (this.actionsBusy() || group.members.length === 0) {
      return;
    }

    const codesLabel =
      group.serialCodes.length > 0 ? ` (קודים: ${group.serialCodes.join(', ')})` : '';
    const qtyLabel = group.quantity > 1 ? ` ×${group.quantity}` : '';
    const ok = window.confirm(
      `האם לבטל את ההחזרה של "${group.itemName}"${qtyLabel}${codesLabel} ולהחזיר את הפריט להשאלות פעילות?`
    );
    if (!ok) {
      return;
    }

    this.undoingRowKey.set(group.rowKey);
    const memberKeys = new Set(group.members.map((m) => m.rowKey));

    const requests = group.members.map((row) => {
      if (row.manualItemId != null && row.manualItemId > 0) {
        return this.data.undoResolvedManualUnreturnedItem(row.manualItemId);
      }
      return this.data.undoOrderReturn(row.orderId, {
        loanedEquipmentId: row.loanedEquipmentId,
        serialCode: row.serialCode ?? null,
        quantity: row.serialCode ? null : row.quantity
      });
    });

    forkJoin(requests.length > 0 ? requests : [of(null)])
      .pipe(finalize(() => this.undoingRowKey.set(null)))
      .subscribe((results) => {
        const okCount = results.filter((r) => !!r).length;
        if (okCount === 0) {
          return;
        }
        const hasManual = group.members.some((m) => m.manualItemId != null && m.manualItemId > 0);
        const orderUpdate = results.find(
          (r) => r != null && typeof r === 'object' && 'id' in (r as object)
        );
        if (hasManual) {
          this.ordersSync.notifyUnreturnedChanged(null);
          this.ordersSync.notifyLoanChanged();
        }
        if (orderUpdate && typeof orderUpdate === 'object' && 'id' in orderUpdate) {
          this.ordersSync.notifyOrderUpdated(orderUpdate as never);
        } else if (!hasManual) {
          this.ordersSync.notifyLoanChanged();
        }
        this.rows.update((list) => list.filter((r) => !memberKeys.has(r.rowKey)));
        this.toast.success('ההחזרה בוטלה — הפריט חזר להשאלות פעילות');
      });
  }

  protected deleteReturnRecord(group: GroupedReturnedAccessoryRow): void {
    if (this.actionsBusy() || group.members.length === 0) {
      return;
    }

    const ok = window.confirm('האם למחוק את רשומת ההחזרה לצמיתות?');
    if (!ok) {
      return;
    }

    this.deletingRowKey.set(group.rowKey);
    const memberKeys = new Set(group.members.map((m) => m.rowKey));

    const requests = group.members.map((row) => {
      if (row.manualItemId != null && row.manualItemId > 0) {
        return this.data.deleteResolvedManualUnreturnedItem(row.manualItemId);
      }
      return this.data.deleteReturnedAccessory(row.orderId, {
        loanedEquipmentId: row.loanedEquipmentId,
        serialCode: row.serialCode ?? null,
        quantity: row.serialCode ? null : row.quantity
      });
    });

    forkJoin(requests.length > 0 ? requests : [of(false)])
      .pipe(finalize(() => this.deletingRowKey.set(null)))
      .subscribe((results) => {
        const okCount = results.filter((r) => !!r).length;
        if (okCount === 0) {
          return;
        }
        if (group.members.some((m) => m.manualItemId != null && m.manualItemId > 0)) {
          this.ordersSync.notifyLoanChanged();
        }
        this.rows.update((list) => list.filter((r) => !memberKeys.has(r.rowKey)));
        this.toast.success('רשומת ההחזרה נמחקה לצמיתות');
      });
  }

  protected formatPhone(phone: string | null | undefined): string {
    const digits = (phone ?? '').replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 9) {
      return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    }
    return (phone ?? '').trim() || '—';
  }

  protected dateLabel(iso: string | null | undefined): string {
    if (!iso) {
      return '—';
    }
    const date = this.hebrew.parseIso(iso);
    return date ? this.hebrew.formatGregorianWithDayName(date) : iso;
  }

  protected hebrewDateLabel(iso: string | null | undefined): string {
    if (!iso) {
      return '';
    }
    const date = this.hebrew.parseIso(iso);
    return date ? this.hebrew.toHebrew(date) : '';
  }

  protected orderLabel(row: ReturnedAccessoryRow): string {
    if (row.manualItemId != null && row.manualItemId > 0 && row.orderId <= 0) {
      return 'רישום ידני';
    }
    return row.isOrderBased ? `הזמנה #${row.orderId}` : `השאלה #${row.orderId}`;
  }

  protected hasOrderLink(row: ReturnedAccessoryRow): boolean {
    return row.orderId > 0;
  }

  private formatDeposit(row: ReturnedAccessoryHistoryDto): string {
    const typeLabel = row.depositType != null ? DEPOSIT_TYPE_LABELS[row.depositType] ?? '' : '';
    const onName = (row.depositOnName ?? '').trim();
    if (typeLabel && onName) {
      return `${typeLabel} — ${onName}`;
    }
    return typeLabel || onName;
  }

  private mapRows(items: ReturnedAccessoryHistoryDto[]): ReturnedAccessoryRow[] {
    return items.map((item, index) => ({
      ...item,
      rowKey: `${item.manualItemId ?? 'order'}-${item.orderId}-${item.loanedEquipmentId}-${item.serialCode ?? 'qty'}-${index}`
    }));
  }

  /**
   * Collapse flat API rows (one per serial) into Active Loans–style rows:
   * same item name + borrow date within the order card → one row + all code badges.
   * Different borrow dates stay as separate rows.
   */
  private groupReturnedAccessoryRows(rows: ReturnedAccessoryRow[]): GroupedReturnedAccessoryRow[] {
    const groups = new Map<string, GroupedReturnedAccessoryRow>();

    for (const row of rows) {
      const nameKey = (row.itemName ?? '').trim().toLowerCase();
      const loanDay = (row.loanDate ?? '').trim();
      // Manual entries stay atomic (each has its own undo id).
      const groupKey =
        row.manualItemId != null && row.manualItemId > 0
          ? `manual:${row.manualItemId}`
          : `name:${nameKey}|day:${loanDay}`;

      const existing = groups.get(groupKey);
      if (!existing) {
        const code = (row.serialCode ?? '').trim();
        groups.set(groupKey, {
          rowKey: `group:${groupKey}`,
          itemName: row.itemName,
          quantity: row.quantity || 1,
          serialCodes: code ? [code] : [],
          isCustomItem: row.isCustomItem,
          loanDate: loanDay || null,
          members: [row]
        });
        continue;
      }

      existing.quantity += row.quantity || 1;
      existing.members.push(row);
      existing.isCustomItem = existing.isCustomItem || row.isCustomItem;
      const code = (row.serialCode ?? '').trim();
      if (code && !existing.serialCodes.some((c) => c.toLowerCase() === code.toLowerCase())) {
        existing.serialCodes.push(code);
      }
    }

    return [...groups.values()]
      .map((g) => ({
        ...g,
        serialCodes: sortNumericCodes(g.serialCodes)
      }))
      .sort(
        (a, b) =>
          (b.loanDate ?? '').localeCompare(a.loanDate ?? '') ||
          a.itemName.localeCompare(b.itemName, 'he')
      );
  }
}
