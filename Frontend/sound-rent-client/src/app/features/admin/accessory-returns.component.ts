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
import { debounceTime, distinctUntilChanged, finalize, startWith, switchMap } from 'rxjs';

import { ReturnedAccessoryHistoryDto } from '../../core/models/equipment-return.model';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';

interface ReturnedAccessoryRow extends ReturnedAccessoryHistoryDto {
  rowKey: string;
}

@Component({
  selector: 'app-accessory-returns',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './accessory-returns.component.html',
  styleUrl: './accessory-returns.component.scss'
})
export class AccessoryReturnsComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
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

  ngOnInit(): void {
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

  protected undoReturn(row: ReturnedAccessoryRow): void {
    if (this.actionsBusy()) {
      return;
    }

    const codePart = row.serialCode ? ` (קוד ${row.serialCode})` : '';
    const ok = window.confirm(
      `האם לבטל את ההחזרה של "${row.itemName}"${codePart} ולהחזיר את הפריט להשאלות פעילות?`
    );
    if (!ok) {
      return;
    }

    this.undoingRowKey.set(row.rowKey);
    this.data
      .undoOrderReturn(row.orderId, {
        loanedEquipmentId: row.loanedEquipmentId,
        serialCode: row.serialCode ?? null,
        quantity: row.serialCode ? null : row.quantity
      })
      .pipe(finalize(() => this.undoingRowKey.set(null)))
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.rows.update((list) => list.filter((r) => r.rowKey !== row.rowKey));
        this.toast.success('ההחזרה בוטלה — הפריט חזר להשאלות פעילות');
      });
  }

  protected deleteReturnRecord(row: ReturnedAccessoryRow): void {
    if (this.actionsBusy()) {
      return;
    }

    const ok = window.confirm('האם למחוק את רשומת ההחזרה לצמיתות?');
    if (!ok) {
      return;
    }

    this.deletingRowKey.set(row.rowKey);
    this.data
      .deleteReturnedAccessory(row.orderId, {
        loanedEquipmentId: row.loanedEquipmentId,
        serialCode: row.serialCode ?? null,
        quantity: row.serialCode ? null : row.quantity
      })
      .pipe(finalize(() => this.deletingRowKey.set(null)))
      .subscribe((okResult) => {
        if (!okResult) {
          return;
        }
        this.rows.update((list) => list.filter((r) => r.rowKey !== row.rowKey));
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
    return row.isOrderBased ? `הזמנה #${row.orderId}` : `השאלה #${row.orderId}`;
  }

  private mapRows(items: ReturnedAccessoryHistoryDto[]): ReturnedAccessoryRow[] {
    return items.map((item, index) => ({
      ...item,
      rowKey: `${item.orderId}-${item.loanedEquipmentId}-${item.serialCode ?? 'qty'}-${index}`
    }));
  }
}
