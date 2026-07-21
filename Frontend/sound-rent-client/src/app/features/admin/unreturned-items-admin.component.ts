import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EMPTY, finalize, merge } from 'rxjs';
import { debounceTime, map, switchMap } from 'rxjs/operators';

import { CustomerSuggestDto } from '../../core/models/customer.model';
import { UnreturnedItemDto } from '../../core/models/equipment-return.model';
import { LoanedEquipmentType } from '../../core/models/enums';
import { InventoryDefinitionDto } from '../../core/models/inventory-definition.model';
import { CustomersStore } from '../../core/services/customers.store';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { InventoryDefinitionsStore } from '../../core/services/inventory-definitions.store';
import { OrdersSyncService } from '../../core/services/orders-sync.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import { IsraeliPhoneInputDirective } from '../../shared/directives/israeli-phone-input.directive';
import {
  ISRAELI_PHONE_INVALID_MESSAGE,
  optionalIsraeliPhoneValidator
} from '../../core/validators/israeli-phone.validator';

@Component({
  selector: 'app-unreturned-items-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, ReactiveFormsModule, IsraeliPhoneInputDirective],
  templateUrl: './unreturned-items-admin.component.html',
  styleUrl: './unreturned-items-admin.component.scss'
})
export class UnreturnedItemsAdminComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly ordersSync = inject(OrdersSyncService);
  private readonly toast = inject(ToastService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly inventory = inject(InventoryDefinitionsStore);
  private readonly customers = inject(CustomersStore);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly pageTitle = inject(WorkspaceUiService).title('פריטים שלא חזרו');

  private static readonly CUSTOMER_SUGGEST_LIMIT = 8;

  protected readonly rows = signal<UnreturnedItemDto[]>([]);
  protected readonly loading = signal(false);
  protected readonly returningKeys = signal<Set<string>>(new Set());
  protected readonly removingKeys = signal<Set<string>>(new Set());

  protected readonly addOpen = signal(false);
  protected readonly savingMissing = signal(false);
  protected readonly itemOptions = this.inventory.definitions;
  protected readonly israeliPhoneInvalidMessage = ISRAELI_PHONE_INVALID_MESSAGE;

  protected readonly customerSuggestions = signal<CustomerSuggestDto[]>([]);
  protected readonly customerSuggestOpen = signal(false);
  protected readonly customerSuggestField = signal<'name' | 'phone' | null>(null);
  protected readonly customerSuggestIndex = signal(-1);

  protected readonly addForm = this.fb.group({
    customerName: ['', [Validators.maxLength(200)]],
    phone: ['', [Validators.maxLength(20), optionalIsraeliPhoneValidator()]],
    address: ['', [Validators.maxLength(200)]],
    isCustomItem: [false],
    inventoryDefinitionId: [null as number | null],
    customItemName: ['', [Validators.maxLength(200)]],
    itemCode: ['', [Validators.maxLength(100)]]
  });

  ngOnInit(): void {
    this.inventory.load().subscribe();
    this.wireCustomerAutocomplete();
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
      customerName: '',
      phone: '',
      address: '',
      isCustomItem: false,
      inventoryDefinitionId: null,
      customItemName: '',
      itemCode: ''
    });
    this.closeCustomerSuggestions();
    this.addOpen.set(true);
  }

  protected closeAddMissing(): void {
    this.addOpen.set(false);
    this.closeCustomerSuggestions();
  }

  protected onCustomItemToggle(): void {
    const checked = this.addForm.controls.isCustomItem.value === true;
    if (checked) {
      this.addForm.patchValue({ inventoryDefinitionId: null });
      this.addForm.controls.inventoryDefinitionId.setErrors(null);
    } else {
      this.addForm.patchValue({ customItemName: '' });
      this.addForm.controls.customItemName.setErrors(null);
    }
  }

  protected customerSuggestLabel(c: CustomerSuggestDto): string {
    const name = (c.fullName ?? '').trim() || 'ללא שם';
    return `${name} - ${c.phone1}`;
  }

  protected onCustomerSuggestFocus(field: 'name' | 'phone'): void {
    this.customerSuggestField.set(field);
    if (this.customerSuggestions().length > 0) {
      this.customerSuggestOpen.set(true);
    }
  }

  protected onCustomerSuggestBlur(): void {
    setTimeout(() => this.closeCustomerSuggestions(), 150);
  }

  protected onCustomerSuggestKeydown(event: KeyboardEvent, field: 'name' | 'phone'): void {
    if (!this.customerSuggestOpen() || this.customerSuggestField() !== field) {
      if (event.key === 'ArrowDown' && this.customerSuggestions().length > 0) {
        this.customerSuggestField.set(field);
        this.customerSuggestOpen.set(true);
        this.customerSuggestIndex.set(0);
        event.preventDefault();
      }
      return;
    }

    const list = this.customerSuggestions();
    if (list.length === 0) {
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.customerSuggestIndex.update((i) => (i + 1) % list.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.customerSuggestIndex.update((i) => (i <= 0 ? list.length - 1 : i - 1));
      return;
    }
    if (event.key === 'Enter') {
      const idx = this.customerSuggestIndex();
      const pick = idx >= 0 ? list[idx] : null;
      if (pick) {
        event.preventDefault();
        this.selectCustomerSuggestion(pick);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeCustomerSuggestions();
    }
  }

  protected selectCustomerSuggestion(c: CustomerSuggestDto, event?: Event): void {
    event?.preventDefault();
    this.addForm.patchValue(
      {
        customerName: c.fullName ?? '',
        phone: c.phone1 ?? '',
        address: c.address ?? ''
      },
      { emitEvent: false }
    );
    this.closeCustomerSuggestions();
    this.toast.show('פרטי הלקוח מולאו מהרשימה', 'info');
  }

  protected submitAddMissing(): void {
    const isCustom = this.addForm.controls.isCustomItem.value === true;
    const catalogCtrl = this.addForm.controls.inventoryDefinitionId;
    const customCtrl = this.addForm.controls.customItemName;

    if (isCustom) {
      catalogCtrl.setErrors(null);
      const customName = (customCtrl.value ?? '').trim();
      if (!customName) {
        customCtrl.setErrors({ required: true });
      }
    } else {
      customCtrl.setErrors(null);
      if (catalogCtrl.value == null) {
        catalogCtrl.setErrors({ required: true });
      }
    }

    if (this.addForm.invalid) {
      this.addForm.markAllAsTouched();
      this.toast.error('אנא מלאו את השדות הנדרשים');
      return;
    }
    if (this.savingMissing()) {
      return;
    }

    const v = this.addForm.getRawValue();
    const itemCode = (v.itemCode ?? '').trim();

    let inventoryDefinitionId: number | null = null;
    let loanedEquipmentType: LoanedEquipmentType | null = null;
    let itemName: string | null = null;

    if (isCustom) {
      itemName = (v.customItemName ?? '').trim();
    } else {
      const definitionId = Number(v.inventoryDefinitionId);
      const def = this.itemOptions().find((d) => d.id === definitionId);
      if (!def) {
        this.toast.error('יש לבחור פריט');
        return;
      }
      inventoryDefinitionId = def.id;
      loanedEquipmentType = (def.linkedEquipmentType as LoanedEquipmentType | null) ?? null;
      itemName = def.displayName;
    }

    this.savingMissing.set(true);
    this.data
      .createManualUnreturnedItem({
        customerName: (v.customerName ?? '').trim() || null,
        phone: (v.phone ?? '').trim() || null,
        address: (v.address ?? '').trim() || null,
        inventoryDefinitionId,
        loanedEquipmentType,
        itemName,
        itemCode: itemCode || null
      })
      .pipe(finalize(() => this.savingMissing.set(false)))
      .subscribe({
        next: (created) => {
          if (!created) {
            return;
          }
          this.rows.update((list) => [created, ...list]);
          this.inventory.load({ force: true }).subscribe();
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
            this.inventory.load({ force: true }).subscribe();
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

  private closeCustomerSuggestions(): void {
    this.customerSuggestOpen.set(false);
    this.customerSuggestIndex.set(-1);
    this.customerSuggestions.set([]);
    this.customerSuggestField.set(null);
  }

  private wireCustomerAutocomplete(): void {
    const name$ = this.addForm.controls.customerName.valueChanges.pipe(
      map((v) => ({ field: 'name' as const, q: String(v ?? '').trim() }))
    );
    const phone$ = this.addForm.controls.phone.valueChanges.pipe(
      map((v) => ({ field: 'phone' as const, q: String(v ?? '').trim() }))
    );

    merge(name$, phone$)
      .pipe(
        debounceTime(300),
        switchMap(({ field, q }) => {
          if (q.length < 2) {
            this.closeCustomerSuggestions();
            return EMPTY;
          }
          return this.customers.searchSuggest(q).pipe(
            map((list) => ({
              field,
              q,
              list: list.slice(0, UnreturnedItemsAdminComponent.CUSTOMER_SUGGEST_LIMIT)
            }))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ field, q, list }) => {
        const current =
          field === 'name'
            ? String(this.addForm.controls.customerName.value ?? '').trim()
            : String(this.addForm.controls.phone.value ?? '').trim();
        if (current !== q) {
          return;
        }
        if (list.length === 0) {
          this.closeCustomerSuggestions();
          return;
        }
        this.customerSuggestField.set(field);
        this.customerSuggestions.set(list);
        this.customerSuggestIndex.set(0);
        this.customerSuggestOpen.set(true);
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
