import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize, map, Observable, of } from 'rxjs';

import { UnreturnedItemDto } from '../../core/models/equipment-return.model';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
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
    if (row.isCustomItem && row.customMissingItemId != null) {
      return `${row.orderId}-custom-${row.customMissingItemId}`;
    }
    return `${row.orderId}-${row.loanedEquipmentType}`;
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

  protected quickReturn(row: UnreturnedItemDto): void {
    const key = this.rowKey(row);
    if (this.isReturning(row)) {
      return;
    }

    this.returningKeys.update((set) => new Set(set).add(key));

    const action$: Observable<boolean> =
      row.isCustomItem && row.customMissingItemId != null
        ? this.data.resolveCustomMissingItem(row.customMissingItemId)
        : this.data
            .recordOrderReturn(row.orderId, {
              items: [
                {
                  loanedEquipmentType: row.loanedEquipmentType!,
                  quantityReturned: row.quantityLoaned
                }
              ],
              customMissingItems: []
            })
            .pipe(map((updated) => updated !== null));

    action$
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
        next: (ok) => {
          if (!ok) {
            return;
          }
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
