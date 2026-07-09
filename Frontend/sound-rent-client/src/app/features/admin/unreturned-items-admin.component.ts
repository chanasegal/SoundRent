import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { UnreturnedItemDto } from '../../core/models/equipment-return.model';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { OrdersSyncService } from '../../core/services/orders-sync.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-unreturned-items-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink],
  templateUrl: './unreturned-items-admin.component.html',
  styleUrl: './unreturned-items-admin.component.scss'
})
export class UnreturnedItemsAdminComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly ordersSync = inject(OrdersSyncService);
  private readonly toast = inject(ToastService);
  private readonly hebrew = inject(HebrewDateService);

  protected readonly rows = signal<UnreturnedItemDto[]>([]);
  protected readonly loading = signal(false);
  protected readonly returningKeys = signal<Set<string>>(new Set());
  protected readonly removingKeys = signal<Set<string>>(new Set());

  ngOnInit(): void {
    this.refresh();
  }

  protected refresh(): void {
    this.loading.set(true);
    this.data
      .getUnreturnedItems()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (list) => this.rows.set(list)
      });
  }

  protected rowKey(row: UnreturnedItemDto): string {
    return `${row.orderId}-line-${row.loanedEquipmentId}`;
  }

  protected isReturning(row: UnreturnedItemDto): boolean {
    return this.returningKeys().has(this.rowKey(row));
  }

  protected isRemoving(row: UnreturnedItemDto): boolean {
    return this.removingKeys().has(this.rowKey(row));
  }

  protected formatReturnDate(iso: string): string {
    const d = this.hebrew.parseIso(iso);
    return d ? this.hebrew.formatGregorianWithDayName(d) : iso;
  }

  protected formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
  }

  protected hasMissingSerialCodes(row: UnreturnedItemDto): boolean {
    return (row.missingSerialCodes ?? []).length > 0;
  }

  protected missingSerialCodesLabel(row: UnreturnedItemDto): string {
    return (row.missingSerialCodes ?? []).join(', ');
  }

  protected quickReturn(row: UnreturnedItemDto): void {
    const key = this.rowKey(row);
    if (this.isReturning(row)) {
      return;
    }

    const assignedCodes = row.assignedSerialCodes ?? [];
    const hasSerializedLine = !row.isCustomItem && assignedCodes.length > 0;
    const quantityReturned = hasSerializedLine ? assignedCodes.length : row.quantityLoaned;

    this.returningKeys.update((set) => new Set(set).add(key));
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
      .pipe(
        finalize(() =>
          this.returningKeys.update((set) => {
            const next = new Set(set);
            next.delete(key);
            return next;
          })
        )
      )
      .subscribe({
        next: (updated) => {
          if (!updated) {
            return;
          }
          this.ordersSync.notifyOrderUpdated(updated);
          this.removingKeys.update((set) => new Set(set).add(key));
          window.setTimeout(() => {
            this.rows.update((list) => list.filter((r) => this.rowKey(r) !== key));
            this.removingKeys.update((set) => {
              const next = new Set(set);
              next.delete(key);
              return next;
            });
          }, 280);
          this.toast.success('הפריט סומן כהוחזר');
        }
      });
  }
}
