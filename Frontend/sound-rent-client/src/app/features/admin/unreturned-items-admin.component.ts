import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { EMPTY, concatMap, finalize, from, merge, toArray } from 'rxjs';
import { debounceTime, map, switchMap } from 'rxjs/operators';

import { CustomerSuggestDto } from '../../core/models/customer.model';
import {
  CreateManualUnreturnedItemDto,
  UnreturnedItemDto
} from '../../core/models/equipment-return.model';
import { InventoryDefinitionDto } from '../../core/models/inventory-definition.model';
import { CustomersStore } from '../../core/services/customers.store';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { InventoryDefinitionsStore } from '../../core/services/inventory-definitions.store';
import { OrdersSyncService } from '../../core/services/orders-sync.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import { startLiveDataRefresh } from '../../core/utils/live-data-refresh';
import { sortNumericCodes } from '../../core/utils/numeric-code-sort';
import { IsraeliPhoneInputDirective } from '../../shared/directives/israeli-phone-input.directive';
import { ClickOutsideDirective } from '../../shared/directives/click-outside.directive';
import {
  ISRAELI_PHONE_INVALID_MESSAGE,
  clampIsraeliPhoneDigits,
  optionalIsraeliPhoneValidator
} from '../../core/validators/israeli-phone.validator';

interface AddMissingItemRowValue {
  isCustomItem: boolean;
  inventoryDefinitionId: number | null;
  customItemName: string;
  itemCode: string;
}

interface AddMissingSaveEntry {
  payload: CreateManualUnreturnedItemDto;
  isCustomItem: boolean;
}

@Component({
  selector: 'app-unreturned-items-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, ReactiveFormsModule, IsraeliPhoneInputDirective, ClickOutsideDirective],
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
  protected readonly searchQuery = signal('');

  protected readonly addOpen = signal(false);
  protected readonly savingMissing = signal(false);
  protected readonly itemOptionsLoading = signal(false);
  protected readonly itemOptions = this.inventory.definitions;
  protected readonly israeliPhoneInvalidMessage = ISRAELI_PHONE_INVALID_MESSAGE;

  protected readonly customerSuggestions = signal<CustomerSuggestDto[]>([]);
  protected readonly customerSuggestOpen = signal(false);
  protected readonly customerSuggestField = signal<'name' | 'phone' | null>(null);
  protected readonly customerSuggestIndex = signal(-1);

  protected readonly filteredRows = computed(() =>
    this.sortRowsNewestFirst(
      this.filterRows(
        this.rows().map((row) => this.inventory.enrichUnreturnedItem(row)),
        this.searchQuery()
      )
    )
  );

  protected readonly addForm = this.fb.group({
    customerName: ['', [Validators.maxLength(200)]],
    phone: ['', [Validators.maxLength(20), optionalIsraeliPhoneValidator()]],
    address: ['', [Validators.maxLength(200)]],
    items: this.fb.array([this.createAddItemRowGroup()])
  });

  protected itemRows(): FormArray {
    return this.addForm.get('items') as FormArray;
  }

  protected itemRowGroup(index: number): FormGroup {
    return this.itemRows().at(index) as FormGroup;
  }

  private createAddItemRowGroup(): FormGroup {
    return this.fb.group({
      isCustomItem: [false],
      inventoryDefinitionId: [{ value: null as number | null, disabled: this.itemOptionsLoading() }],
      customItemName: ['', [Validators.maxLength(200)]],
      itemCode: ['', [Validators.maxLength(100)]]
    });
  }

  constructor() {
    effect(() => {
      const loading = this.itemOptionsLoading();
      untracked(() => this.syncInventoryDefinitionSelectState(loading));
    });
  }

  ngOnInit(): void {
    this.inventory.load().subscribe();
    this.wireCustomerAutocomplete();
    this.refresh();

    this.ordersSync.unreturnedChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((created) => {
        if (created) {
          const enriched = this.inventory.enrichUnreturnedItem(created);
          const row: UnreturnedItemDto =
            enriched.inventoryDefinitionId == null || enriched.inventoryDefinitionId <= 0
              ? { ...enriched, isCustomItem: true }
              : enriched;
          this.rows.update((list) => {
            if (list.some((r) => this.rowKey(r) === this.rowKey(row))) {
              return list;
            }
            return [row, ...list];
          });
          return;
        }
        if (!this.addOpen()) {
          this.refresh();
        }
      });

    this.ordersSync.orderChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (!this.addOpen()) {
          this.refresh();
        }
      });

    startLiveDataRefresh(this.destroyRef, () => this.refresh(), {
      skipWhen: () =>
        this.addOpen() ||
        this.loading() ||
        this.savingMissing() ||
        this.removingKeys().size > 0
    });
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
    this.resetAddItemRows();
    this.addForm.reset({
      customerName: '',
      phone: '',
      address: ''
    });
    this.closeCustomerSuggestions();
    this.addOpen.set(true);
    this.ensureItemOptionsLoaded();
  }

  private ensureItemOptionsLoaded(): void {
    if (this.itemOptions().length > 0) {
      this.itemOptionsLoading.set(false);
      this.syncInventoryDefinitionSelectState(false);
      return;
    }

    this.itemOptionsLoading.set(true);
    this.inventory
      .load()
      .pipe(
        finalize(() => {
          this.itemOptionsLoading.set(false);
          this.syncInventoryDefinitionSelectState(false);
        })
      )
      .subscribe();
  }

  protected addItemRow(): void {
    this.itemRows().push(this.createAddItemRowGroup());
    this.syncInventoryDefinitionSelectState(this.itemOptionsLoading());
  }

  protected removeItemRow(index: number): void {
    if (this.itemRows().length <= 1) {
      return;
    }
    this.itemRows().removeAt(index);
    this.syncInventoryDefinitionSelectState(this.itemOptionsLoading());
  }

  protected onItemCustomToggle(index: number): void {
    const group = this.itemRowGroup(index);
    const checked = group.controls['isCustomItem'].value === true;
    if (checked) {
      group.patchValue({ inventoryDefinitionId: null });
      group.controls['inventoryDefinitionId'].setErrors(null);
    } else {
      group.patchValue({ customItemName: '' });
      group.controls['customItemName'].setErrors(null);
    }
    this.syncInventoryDefinitionSelectState(this.itemOptionsLoading());
  }

  private resetAddItemRows(): void {
    this.itemRows().clear();
    this.itemRows().push(this.createAddItemRowGroup());
    this.syncInventoryDefinitionSelectState(this.itemOptionsLoading());
  }

  private syncInventoryDefinitionSelectState(loading: boolean): void {
    this.itemRows().controls.forEach((ctrl) => {
      const group = ctrl as FormGroup;
      const catalogCtrl = group.controls['inventoryDefinitionId'];
      if (!catalogCtrl) {
        return;
      }

      const isCustom = group.controls['isCustomItem']?.value === true;
      if (loading || isCustom) {
        if (catalogCtrl.enabled) {
          catalogCtrl.disable({ emitEvent: false });
        }
        return;
      }

      if (catalogCtrl.disabled) {
        catalogCtrl.enable({ emitEvent: false });
      }
    });
  }

  protected closeAddMissing(): void {
    this.addOpen.set(false);
    this.closeCustomerSuggestions();
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
    if (!this.validateAddItemRows()) {
      this.addForm.markAllAsTouched();
      this.toast.error('אנא מלאו את השדות הנדרשים');
      return;
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
    const customerName = (v.customerName ?? '').trim() || null;
    const phoneRaw = (v.phone ?? '').trim();
    const phone = phoneRaw ? clampIsraeliPhoneDigits(phoneRaw) || null : null;
    const address = (v.address ?? '').trim() || null;
    const customer = { customerName, phone, address };

    const saveEntries: AddMissingSaveEntry[] = [];
    const itemCodesInBatch: string[] = [];

    for (const ctrl of this.itemRows().controls) {
      const row = (ctrl as FormGroup).getRawValue() as AddMissingItemRowValue;
      const payload = this.buildManualUnreturnedApiPayload(customer, row);
      if (!payload) {
        this.toast.error('יש לבחור פריט');
        return;
      }

      const normalizedCode = (payload.itemCode ?? '').trim();
      if (normalizedCode) {
        itemCodesInBatch.push(normalizedCode);
      }

      saveEntries.push({
        payload,
        isCustomItem: row.isCustomItem === true
      });
    }

    if (itemCodesInBatch.length !== new Set(itemCodesInBatch).size) {
      this.toast.error('קוד פריט כפול — יש להזין קוד ייחודי לכל שורה');
      return;
    }

    this.savingMissing.set(true);
    from(saveEntries)
      .pipe(
        concatMap((entry) =>
          this.data.createManualUnreturnedItem(entry.payload).pipe(
            map((created) => (created ? { created, isCustomItem: entry.isCustomItem } : null))
          )
        ),
        toArray(),
        finalize(() => this.savingMissing.set(false))
      )
      .subscribe({
        next: (results) => {
          const createdRows = results.filter((r): r is NonNullable<typeof r> => r != null);
          if (createdRows.length === 0) {
            return;
          }

          const newRows = createdRows.map(({ created, isCustomItem }) =>
            isCustomItem ? { ...created, isCustomItem: true } : created
          );
          this.rows.update((list) => [...newRows, ...list]);

          if (createdRows.some(({ isCustomItem }) => !isCustomItem)) {
            this.inventory.load({ force: true }).subscribe();
          }

          for (const row of newRows) {
            this.ordersSync.notifyUnreturnedChanged(row);
          }

          this.closeAddMissing();

          if (newRows.length === 1) {
            const isCustom = newRows[0].isCustomItem === true;
            this.toast.success(
              isCustom
                ? 'הפריט החד-פעמי נוסף להשאלות פעילות ולרשימת פריטים שלא חזרו'
                : 'הפריט נוסף להשאלות פעילות ולרשימת פריטים שלא חזרו'
            );
            return;
          }

          if (createdRows.length < saveEntries.length) {
            this.toast.warning(
              `${createdRows.length} מתוך ${saveEntries.length} פריטים נוספו — בדקו את השורות שלא נשמרו`
            );
            return;
          }

          this.toast.success(`${newRows.length} פריטים נוספו להשאלות פעילות ולרשימת פריטים שלא חזרו`);
        }
      });
  }

  private buildManualUnreturnedApiPayload(
    customer: { customerName: string | null; phone: string | null; address: string | null },
    row: AddMissingItemRowValue
  ): CreateManualUnreturnedItemDto | null {
    const itemCode = (row.itemCode ?? '').trim() || null;

    if (row.isCustomItem) {
      const itemName = (row.customItemName ?? '').trim();
      if (!itemName) {
        return null;
      }

      return {
        customerName: customer.customerName,
        phone: customer.phone,
        address: customer.address,
        itemName,
        itemCode
      };
    }

    const definitionId = Number(row.inventoryDefinitionId);
    if (!Number.isFinite(definitionId) || definitionId <= 0) {
      return null;
    }

    const def = this.itemOptions().find((d) => d.id === definitionId);
    if (!def) {
      return null;
    }

    return {
      customerName: customer.customerName,
      phone: customer.phone,
      address: customer.address,
      inventoryDefinitionId: definitionId,
      itemName: (def.displayName ?? '').trim() || `פריט #${definitionId}`,
      itemCode
    };
  }

  private validateAddItemRows(): boolean {
    let valid = true;

    this.itemRows().controls.forEach((ctrl) => {
      const group = ctrl as FormGroup;
      const row = group.getRawValue() as AddMissingItemRowValue;
      const isCustom = row.isCustomItem === true;
      const catalogCtrl = group.controls['inventoryDefinitionId'];
      const customCtrl = group.controls['customItemName'];

      if (isCustom) {
        catalogCtrl.setErrors(null);
        if (!(row.customItemName ?? '').trim()) {
          customCtrl.setErrors({ required: true });
          valid = false;
        }
      } else {
        customCtrl.setErrors(null);
        if (row.inventoryDefinitionId == null) {
          catalogCtrl.setErrors({ required: true });
          valid = false;
        }
      }
    });

    return valid;
  }

  protected onSearchInput(value: string): void {
    this.searchQuery.set(value);
  }

  protected clearSearch(): void {
    this.searchQuery.set('');
  }

  private filterRows(list: UnreturnedItemDto[], rawQuery: string): UnreturnedItemDto[] {
    const query = rawQuery.trim().toLowerCase();
    if (!query) {
      return list;
    }
    const digitsQuery = query.replace(/\D/g, '');

    return list.filter((row) => {
      if ((row.customerName ?? '').toLowerCase().includes(query)) {
        return true;
      }
      if ((row.equipmentName ?? '').toLowerCase().includes(query)) {
        return true;
      }
      if (row.isCustomItem && 'חד-פעמי'.includes(query)) {
        return true;
      }
      if (row.orderId > 0 && (String(row.orderId).includes(query) || String(row.orderId).includes(digitsQuery))) {
        return true;
      }
      const phoneDigits = (row.phone ?? '').replace(/\D/g, '');
      if (digitsQuery && phoneDigits.includes(digitsQuery)) {
        return true;
      }
      if ((row.phone ?? '').toLowerCase().includes(query)) {
        return true;
      }
      return (
        (row.missingSerialCodes ?? []).some((c) => c.toLowerCase().includes(query)) ||
        (row.assignedSerialCodes ?? []).some((c) => c.toLowerCase().includes(query))
      );
    });
  }

  /** Newest return/loan date first. Invalid or missing dates sink to the bottom. */
  private sortRowsNewestFirst(list: UnreturnedItemDto[]): UnreturnedItemDto[] {
    return [...list].sort((a, b) => {
      const dateCmp = this.returnDateSortKey(b.returnDate) - this.returnDateSortKey(a.returnDate);
      if (dateCmp !== 0) {
        return dateCmp;
      }
      if (b.orderId !== a.orderId) {
        return b.orderId - a.orderId;
      }
      const manualA = a.manualItemId ?? 0;
      const manualB = b.manualItemId ?? 0;
      if (manualB !== manualA) {
        return manualB - manualA;
      }
      return (b.loanedEquipmentId ?? 0) - (a.loanedEquipmentId ?? 0);
    });
  }

  private returnDateSortKey(iso: string | null | undefined): number {
    const raw = String(iso ?? '').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      if (year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return Date.UTC(year, month - 1, day);
      }
    }

    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
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

  protected sortedMissingSerialCodes(row: UnreturnedItemDto): string[] {
    return sortNumericCodes(row.missingSerialCodes ?? []);
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
            this.ordersSync.notifyUnreturnedChanged(null);
            this.animateRowOut(key);
            this.toast.success('הפריט סומן כהוחזר');
          }
        });
      return;
    }

    const assignedCodes = row.assignedSerialCodes ?? [];
    const hasSerializedLine = assignedCodes.length > 0;
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

  protected closeCustomerSuggestions(): void {
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
