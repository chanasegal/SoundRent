import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { UnreturnedItemDto } from '../../core/models/equipment-return.model';
import { LoanedEquipmentType } from '../../core/models/enums';
import { InventoryDefinitionDto } from '../../core/models/inventory-definition.model';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { InventoryDefinitionsStore } from '../../core/services/inventory-definitions.store';
import { OrdersSyncService } from '../../core/services/orders-sync.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';

@Component({
  selector: 'app-unreturned-items-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, ReactiveFormsModule],
  templateUrl: './unreturned-items-admin.component.html',
  styleUrl: './unreturned-items-admin.component.scss'
})
export class UnreturnedItemsAdminComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly ordersSync = inject(OrdersSyncService);
  private readonly toast = inject(ToastService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly inventory = inject(InventoryDefinitionsStore);
  private readonly fb = inject(FormBuilder);
  protected readonly pageTitle = inject(WorkspaceUiService).title('פריטים שלא חזרו');

  protected readonly rows = signal<UnreturnedItemDto[]>([]);
  protected readonly loading = signal(false);
  protected readonly returningKeys = signal<Set<string>>(new Set());
  protected readonly removingKeys = signal<Set<string>>(new Set());

  protected readonly addOpen = signal(false);
  protected readonly savingMissing = signal(false);
  protected readonly itemOptions = this.inventory.definitions;

  protected readonly addForm = this.fb.group({
    inventoryDefinitionId: [null as number | null, Validators.required],
    itemCode: ['', [Validators.required, Validators.maxLength(100)]]
  });

  ngOnInit(): void {
    this.inventory.load().subscribe();
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

  protected openAddMissing(): void {
    this.addForm.reset({
      inventoryDefinitionId: null,
      itemCode: ''
    });
    this.addOpen.set(true);
  }

  protected closeAddMissing(): void {
    this.addOpen.set(false);
  }

  protected submitAddMissing(): void {
    if (this.addForm.invalid) {
      this.addForm.markAllAsTouched();
      this.toast.error('אנא מלאו את השדות הנדרשים');
      return;
    }
    if (this.savingMissing()) {
      return;
    }

    const v = this.addForm.getRawValue();
    const definitionId = Number(v.inventoryDefinitionId);
    const def = this.itemOptions().find((d) => d.id === definitionId);
    if (!def) {
      this.toast.error('יש לבחור פריט');
      return;
    }

    const itemCode = (v.itemCode ?? '').trim();
    if (!itemCode) {
      this.toast.error('יש להזין קוד פריט');
      return;
    }

    this.savingMissing.set(true);
    this.data
      .createManualUnreturnedItem({
        inventoryDefinitionId: def.id,
        loanedEquipmentType: (def.linkedEquipmentType as LoanedEquipmentType | null) ?? null,
        itemName: def.displayName,
        itemCode
      })
      .pipe(finalize(() => this.savingMissing.set(false)))
      .subscribe({
        next: (created) => {
          if (!created) {
            return;
          }
          this.rows.update((list) => [created, ...list]);
          this.closeAddMissing();
          this.toast.success('הפריט נוסף לרשימת פריטים שלא חזרו');
        }
      });
  }

  protected itemOptionLabel(def: InventoryDefinitionDto): string {
    return def.displayName?.trim() || `פריט #${def.id}`;
  }

  protected rowKey(row: UnreturnedItemDto): string {
    if (row.manualItemId) {
      return `manual-${row.manualItemId}`;
    }
    return `${row.orderId}-line-${row.loanedEquipmentId}`;
  }

  protected isManualRow(row: UnreturnedItemDto): boolean {
    return row.manualItemId != null && row.manualItemId > 0;
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

  protected formatReturnHebrewDate(iso: string): string {
    const d = this.hebrew.parseIso(iso);
    return d ? this.hebrew.toHebrew(d) : '';
  }

  protected formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone || '—';
  }

  protected hasMissingSerialCodes(row: UnreturnedItemDto): boolean {
    return (row.missingSerialCodes ?? []).length > 0;
  }

  protected quickReturn(row: UnreturnedItemDto): void {
    const key = this.rowKey(row);
    if (this.isReturning(row)) {
      return;
    }

    if (this.isManualRow(row) && row.manualItemId) {
      this.returningKeys.update((set) => new Set(set).add(key));
      this.data
        .resolveManualUnreturnedItem(row.manualItemId)
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
            this.animateRowOut(key);
            this.toast.success('הפריט סומן כהוחזר');
          }
        });
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
          this.animateRowOut(key);
          this.toast.success('הפריט סומן כהוחזר');
        }
      });
  }

  private animateRowOut(key: string): void {
    this.removingKeys.update((set) => new Set(set).add(key));
    window.setTimeout(() => {
      this.rows.update((list) => list.filter((r) => this.rowKey(r) !== key));
      this.removingKeys.update((set) => {
        const next = new Set(set);
        next.delete(key);
        return next;
      });
    }, 280);
  }
}
