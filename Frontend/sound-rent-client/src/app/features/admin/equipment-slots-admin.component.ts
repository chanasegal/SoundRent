import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
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
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { distinctUntilChanged, map, startWith } from 'rxjs/operators';

import { AccessorySerialLocationDto } from '../../core/models/accessory-inventory.model';
import {
  EquipmentDefinitionDeleteFutureOrder,
  EquipmentDefinitionDto
} from '../../core/models/equipment-definition.model';
import { InventoryDefinitionDto } from '../../core/models/inventory-definition.model';
import { LOANED_EQUIPMENT_ORDER, LoanedEquipmentType } from '../../core/models/enums';
import { DataService } from '../../core/services/data.service';
import { EquipmentDefinitionsStore } from '../../core/services/equipment-definitions.store';
import { EquipmentMaintenanceSyncService } from '../../core/services/equipment-maintenance-sync.service';
import { InventoryDefinitionsStore } from '../../core/services/inventory-definitions.store';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import { IntegerOnlyDirective } from '../../shared/directives/integer-only.directive';

@Component({
  selector: 'app-equipment-slots-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, IntegerOnlyDirective, RouterLink],
  templateUrl: './equipment-slots-admin.component.html',
  styleUrl: './equipment-slots-admin.component.scss'
})
export class EquipmentSlotsAdminComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly store = inject(EquipmentDefinitionsStore);
  private readonly inventoryStore = inject(InventoryDefinitionsStore);
  private readonly maintenanceSync = inject(EquipmentMaintenanceSyncService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly pageTitle = inject(WorkspaceUiService).title('ניהול ציוד');

  /** Shared sorted inventory catalog (A–Z) — same source as loan / lookup screens. */
  protected readonly inventoryCatalog = this.inventoryStore.definitions;

  /**
   * Local row order for the editable inventory table (kept stable during an edit session).
   * Rebuilt from the shared store on full load / batch save.
   */
  protected readonly customInventoryDefinitions = signal<InventoryDefinitionDto[]>([]);

  protected readonly accessoryLoading = signal(true);
  protected readonly accessorySaving = signal(false);
  protected readonly serialSearchLoading = signal(false);
  protected readonly serialLocationResult = signal<AccessorySerialLocationDto | null>(null);
  protected readonly serialSearchAttempted = signal(false);
  protected readonly serialTypeQuery = signal('');
  protected readonly serialTypePickerOpen = signal(false);

  protected readonly serialSearchForm = this.fb.group({
    inventoryDefinitionId: this.fb.control<number | null>(null, Validators.required),
    serialCode: ['', Validators.required]
  });

  /** Catalog options for איתור קוד פריט, filtered by typed query (catalog already A–Z). */
  protected readonly filteredSerialTypes = computed(() => {
    const query = this.serialTypeQuery().trim().toLowerCase();
    const all = this.inventoryCatalog();
    if (!query) {
      return all;
    }
    return all.filter((d) => d.displayName.toLowerCase().includes(query));
  });

  protected readonly accessoryForm = this.fb.group({
    rows: this.fb.array(LOANED_EQUIPMENT_ORDER.map((type) => this.buildAccessoryRow(type)))
  });

  /** Standalone inventory catalog rows (InventoryDefinitions) — not board columns. */
  protected readonly customInventoryForm = this.fb.group({
    rows: this.fb.array<FormGroup>([])
  });

  constructor() {
    effect(() => {
      const v = this.maintenanceSync.version();
      if (v === 0) {
        return;
      }
      untracked(() => this.refresh());
    });
  }

  protected readonly saving = signal(false);
  protected readonly inventorySaving = signal(false);
  protected readonly editSaving = signal(false);
  protected readonly editOpen = signal(false);
  protected readonly addSlotOpen = signal(false);
  protected readonly addInventoryOpen = signal(false);
  protected readonly editInventoryOpen = signal(false);
  protected readonly editInventorySaving = signal(false);
  protected readonly editingInventoryId = signal<number | null>(null);
  protected readonly deletingInventoryId = signal<number | null>(null);
  protected readonly editingId = signal<string | null>(null);
  protected readonly deletingId = signal<string | null>(null);
  protected readonly futureOrdersModal = signal<EquipmentDefinitionDeleteFutureOrder[] | null>(null);
  protected readonly maintenanceTogglingId = signal<string | null>(null);

  /** Creates a single booking-slot column on the weekly board (not accessory inventory). */
  protected readonly addSlotForm = this.fb.group({
    displayName: ['', [Validators.required, Validators.maxLength(200)]],
    code: [
      '',
      [
        Validators.required,
        Validators.maxLength(64),
        Validators.pattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
      ]
    ]
  });

  /**
   * Creates a standalone inventory definition (name + optional qty/serials).
   * Saved via POST /api/inventory-definitions — never to EquipmentDefinitions.
   */
  protected readonly addInventoryForm = this.fb.group({
    displayName: ['', [Validators.required, Validators.maxLength(200)]],
    quantity: [0 as number | null, [Validators.min(0), Validators.max(200)]],
    codes: this.fb.array<FormControl<string>>([])
  });

  protected readonly editForm = this.fb.group({
    displayName: ['', [Validators.required, Validators.maxLength(200)]],
    sortOrder: [0, [Validators.required, Validators.min(0), Validators.max(1_000_000)]]
  });

  protected readonly editInventoryForm = this.fb.group({
    displayName: ['', [Validators.required, Validators.maxLength(200)]]
  });

  ngOnInit(): void {
    this.wireAccessoryQuantitySync();
    this.wireSerialSearchTypeFilter();
    this.wireAddInventoryQuantitySync();
    this.refresh();
  }

  protected isBoardColumnCategory(category: string | null | undefined): boolean {
    return EquipmentDefinitionsStore.isBoardColumnCategory(category);
  }

  protected serialCodesForSearchType(): string[] {
    const id = this.serialSearchForm.controls.inventoryDefinitionId.value;
    if (id == null) {
      return [];
    }
    const def = this.inventoryStore.byId(id);
    return [...(def?.serialCodes ?? [])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  }

  protected selectedSerialTypeLabel(): string {
    const id = this.serialSearchForm.controls.inventoryDefinitionId.value;
    if (id == null) {
      return '';
    }
    return this.inventoryStore.byId(id)?.displayName ?? '';
  }

  protected onSerialTypeQueryInput(value: string): void {
    this.serialTypeQuery.set(value);
    this.serialTypePickerOpen.set(true);
  }

  protected onSerialTypeFocus(): void {
    const selected = this.selectedSerialTypeLabel();
    if (this.serialTypeQuery().trim() === selected.trim()) {
      this.serialTypeQuery.set('');
    }
    this.serialTypePickerOpen.set(true);
  }

  protected onSerialTypeBlur(): void {
    // Delay so option mousedown/click can run before the list closes.
    window.setTimeout(() => {
      this.serialTypePickerOpen.set(false);
      this.syncSerialTypeQueryFromSelection();
    }, 150);
  }

  protected onSerialTypeChosen(def: InventoryDefinitionDto): void {
    this.serialSearchForm.patchValue({ inventoryDefinitionId: def.id });
    this.serialTypeQuery.set(def.displayName);
    this.serialTypePickerOpen.set(false);
  }

  private syncSerialTypeQueryFromSelection(): void {
    this.serialTypeQuery.set(this.selectedSerialTypeLabel());
  }

  protected searchSerialLocation(): void {
    const id = this.serialSearchForm.controls.inventoryDefinitionId.value;
    const serialCode = (this.serialSearchForm.controls.serialCode.value ?? '').trim();
    if (id == null) {
      this.serialSearchForm.controls.inventoryDefinitionId.markAsTouched();
      this.toast.error('יש לבחור סוג אביזר');
      return;
    }
    if (!serialCode) {
      this.serialSearchForm.controls.serialCode.markAsTouched();
      this.toast.error('יש לבחור קוד פריט לחיפוש');
      return;
    }

    const def = this.inventoryStore.byId(id);
    if (!def) {
      this.toast.error('פריט המלאי לא נמצא');
      return;
    }

    const linked = def.linkedEquipmentType as LoanedEquipmentType | null | undefined;
    if (linked && LOANED_EQUIPMENT_ORDER.includes(linked)) {
      this.serialSearchLoading.set(true);
      this.serialSearchAttempted.set(true);
      this.data
        .getAccessorySerialLocation(linked, serialCode)
        .pipe(finalize(() => this.serialSearchLoading.set(false)))
        .subscribe((result) => {
          if (result) {
            this.serialLocationResult.set(result);
          }
        });
      return;
    }

    // Custom (unlinked) inventory rows — location is derived from the catalog serials.
    this.serialSearchAttempted.set(true);
    const registered = (def.serialCodes ?? []).some(
      (c) => c.localeCompare(serialCode, undefined, { sensitivity: 'accent' }) === 0
    );
    this.serialLocationResult.set({
      equipmentType: LoanedEquipmentType.Connectors,
      label: def.displayName,
      serialCode,
      isRegistered: registered,
      isInWarehouse: registered
    });
  }

  protected clearSerialSearch(): void {
    this.serialSearchAttempted.set(false);
    this.serialLocationResult.set(null);
    this.serialSearchForm.patchValue({ serialCode: '' });
  }

  protected formatLocatorPhone(phone: string | null | undefined): string {
    const digits = (phone ?? '').replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone ?? '';
  }

  protected accessoryRows(): FormArray {
    return this.accessoryForm.get('rows') as FormArray;
  }

  protected accessoryRowGroup(index: number): FormGroup {
    return this.accessoryRows().at(index) as FormGroup;
  }

  protected accessoryCodesArray(rowIndex: number): FormArray<FormControl<string>> {
    return this.accessoryRowGroup(rowIndex).get('codes') as FormArray<FormControl<string>>;
  }

  protected codeIndicesForAccessoryRow(rowIndex: number): number[] {
    const len = this.accessoryCodesArray(rowIndex).length;
    return Array.from({ length: len }, (_, i) => i);
  }

  protected isMicrophoneAccessoryRow(rowIndex: number): boolean {
    return this.accessoryRowGroup(rowIndex).get('equipmentType')?.value === LoanedEquipmentType.Microphone;
  }

  protected focusNextSerialInput(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const current = event.target;
    if (!(current instanceof HTMLInputElement)) {
      return;
    }

    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input.note-input[data-serial-nav="1"]')
    );
    const index = inputs.indexOf(current);
    if (index < 0 || index >= inputs.length - 1) {
      return;
    }

    const next = inputs[index + 1];
    next.focus();
    next.select();
  }

  protected refresh(): void {
    this.store.invalidate();
    this.store.load().subscribe();
    this.loadAccessoryInventory();
  }

  protected loadAccessoryInventory(): void {
    this.accessoryLoading.set(true);
    this.inventoryStore.invalidate();
    this.inventoryStore
      .load({ force: true })
      .pipe(finalize(() => this.accessoryLoading.set(false)))
      .subscribe(() => {
        const list = this.inventoryStore.definitions();
        this.customInventoryDefinitions.set(list);
        this.rebuildCustomInventoryRows(list);
        this.ensureSerialSearchSelection(list);
      });
  }

  private ensureSerialSearchSelection(list: InventoryDefinitionDto[]): void {
    const current = this.serialSearchForm.controls.inventoryDefinitionId.value;
    if (current != null && list.some((d) => d.id === current)) {
      this.syncSerialTypeQueryFromSelection();
      return;
    }
    this.serialSearchForm.patchValue(
      { inventoryDefinitionId: list[0]?.id ?? null },
      { emitEvent: false }
    );
    this.syncSerialTypeQueryFromSelection();
  }

  private rebuildCustomInventoryRows(defs: InventoryDefinitionDto[]): void {
    const rows = this.customInventoryRows();
    while (rows.length > 0) {
      rows.removeAt(0);
    }
    for (const def of defs) {
      const group = this.buildCustomInventoryRow(def);
      rows.push(group);
      this.wireCustomInventoryRowQuantitySync(group);
    }
  }

  protected customInventoryRows(): FormArray {
    return this.customInventoryForm.get('rows') as FormArray;
  }

  protected customInventoryRowGroup(index: number): FormGroup {
    return this.customInventoryRows().at(index) as FormGroup;
  }

  protected customInventoryCodesArray(rowIndex: number): FormArray<FormControl<string>> {
    return this.customInventoryRowGroup(rowIndex).get('codes') as FormArray<FormControl<string>>;
  }

  protected codeIndicesForCustomInventoryRow(rowIndex: number): number[] {
    const len = this.customInventoryCodesArray(rowIndex).length;
    return Array.from({ length: len }, (_, i) => i);
  }

  protected openEditInventoryItem(def: InventoryDefinitionDto): void {
    this.editingInventoryId.set(def.id);
    this.editInventoryForm.reset({ displayName: def.displayName });
    this.editInventoryOpen.set(true);
  }

  protected closeEditInventoryItem(): void {
    this.editInventoryOpen.set(false);
    this.editingInventoryId.set(null);
  }

  protected saveEditInventoryItem(): void {
    const id = this.editingInventoryId();
    if (id === null) {
      return;
    }
    if (this.editInventoryForm.invalid) {
      this.editInventoryForm.markAllAsTouched();
      this.toast.error('אנא תקנו את השדות המסומנים');
      return;
    }

    const displayName = (this.editInventoryForm.controls.displayName.value ?? '').trim();
    if (!displayName) {
      this.toast.error('יש להזין שם פריט');
      return;
    }

    this.editInventorySaving.set(true);
    this.data
      .updateInventoryDefinition(id, { displayName })
      .pipe(finalize(() => this.editInventorySaving.set(false)))
      .subscribe({
        next: (updated) => {
          if (updated === null) {
            return;
          }
          this.toast.success('שם הפריט עודכן');
          this.applyInventoryDefinitionPatch(updated);
          this.closeEditInventoryItem();
        }
      });
  }

  protected deleteInventoryItem(def: InventoryDefinitionDto, rowIndex: number): void {
    if (!confirm('האם אתה בטוח שברצונך למחוק פריט זה?')) {
      return;
    }

    this.deletingInventoryId.set(def.id);
    this.data
      .deleteInventoryDefinition(def.id)
      .pipe(finalize(() => this.deletingInventoryId.set(null)))
      .subscribe({
        next: (ok) => {
          if (!ok) {
            return;
          }
          this.removeCustomInventoryRow(def.id, rowIndex);
          this.toast.success(`הפריט "${def.displayName}" נמחק`);
        }
      });
  }

  private applyInventoryDefinitionPatch(updated: InventoryDefinitionDto): void {
    this.inventoryStore.upsert(updated);
    this.customInventoryDefinitions.update((rows) =>
      rows.map((r) => (r.id === updated.id ? { ...r, ...updated } : r))
    );
    const rows = this.customInventoryRows();
    for (let i = 0; i < rows.length; i++) {
      const group = rows.at(i) as FormGroup;
      if (Number(group.get('id')?.value) === updated.id) {
        group.patchValue({ displayName: updated.displayName }, { emitEvent: false });
        break;
      }
    }
  }

  private removeCustomInventoryRow(id: number, rowIndex: number): void {
    const rows = this.customInventoryRows();
    if (rowIndex >= 0 && rowIndex < rows.length) {
      const atIndex = Number((rows.at(rowIndex) as FormGroup).get('id')?.value);
      if (atIndex === id) {
        rows.removeAt(rowIndex);
      } else {
        const found = rows.controls.findIndex(
          (c) => Number((c as FormGroup).get('id')?.value) === id
        );
        if (found >= 0) {
          rows.removeAt(found);
        }
      }
    } else {
      const found = rows.controls.findIndex(
        (c) => Number((c as FormGroup).get('id')?.value) === id
      );
      if (found >= 0) {
        rows.removeAt(found);
      }
    }

    this.inventoryStore.remove(id);
    this.customInventoryDefinitions.update((defs) => defs.filter((d) => d.id !== id));
    this.ensureSerialSearchSelection(this.inventoryStore.definitions());
  }

  private buildCustomInventoryRow(def: InventoryDefinitionDto): FormGroup {
    const codes = (def.serialCodes ?? []).map((c) => c.trim()).filter((c) => c.length > 0);
    const codesFa = this.fb.array<FormControl<string>>(
      codes.map((code) => this.fb.nonNullable.control(code, [Validators.maxLength(100)]))
    );
    return this.fb.group({
      id: this.fb.nonNullable.control(def.id),
      displayName: this.fb.nonNullable.control(def.displayName),
      linkedEquipmentType: this.fb.control<string | null>(def.linkedEquipmentType ?? null),
      quantity: this.fb.control(codes.length, [Validators.min(0)]),
      codes: codesFa
    });
  }

  protected isMicrophoneInventoryRow(rowIndex: number): boolean {
    const linked = this.customInventoryRowGroup(rowIndex).get('linkedEquipmentType')?.value;
    return linked === LoanedEquipmentType.Microphone;
  }

  protected isLinkedInventoryRow(rowIndex: number): boolean {
    const linked = this.customInventoryRowGroup(rowIndex).get('linkedEquipmentType')?.value;
    return typeof linked === 'string' && linked.length > 0;
  }

  private wireCustomInventoryRowQuantitySync(group: FormGroup): void {
    const quantityCtrl = group.get('quantity');
    if (!quantityCtrl) {
      return;
    }
    quantityCtrl.valueChanges
      .pipe(
        map((value) => this.toNonNegativeInteger(value)),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((quantity) => this.setCustomInventoryCodesLength(group, quantity));
  }

  private setCustomInventoryCodesLength(group: FormGroup, target: number): void {
    const length = this.toNonNegativeInteger(target);
    const codes = group.get('codes') as FormArray<FormControl<string>> | null;
    if (!codes) {
      return;
    }
    while (codes.length < length) {
      codes.push(this.fb.nonNullable.control('', [Validators.maxLength(100)]));
    }
    while (codes.length > length) {
      codes.removeAt(codes.length - 1);
    }
  }

  private wireSerialSearchTypeFilter(): void {
    this.serialSearchForm.controls.inventoryDefinitionId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.serialSearchForm.patchValue({ serialCode: '' }, { emitEvent: false });
        this.serialLocationResult.set(null);
        this.serialSearchAttempted.set(false);
      });
  }

  protected saveAccessoryInventory(): void {
    const payloads: { id: number; codes: string[]; label: string; linked: string | null }[] = [];

    for (let i = 0; i < this.customInventoryRows().length; i++) {
      const group = this.customInventoryRowGroup(i);
      const id = Number(group.get('id')?.value);
      const label = String(group.get('displayName')?.value ?? '');
      const linked = (group.get('linkedEquipmentType')?.value as string | null) ?? null;
      const codesFa = this.customInventoryCodesArray(i);
      const serialCodes: string[] = [];

      for (let c = 0; c < codesFa.length; c++) {
        const raw = String(codesFa.at(c).value ?? '').trim();
        if (raw.length === 0) {
          this.toast.error(`יש להזין קוד פריט עבור ${label} (#${c + 1})`);
          return;
        }
        if (linked && !this.isValidAccessorySerialCode(linked as LoanedEquipmentType, raw)) {
          this.toast.error(
            linked === LoanedEquipmentType.Microphone
              ? `קוד מיקרופון לא תקין (#${c + 1}): אותיות, ספרות ומקף בלבד`
              : `קוד לא תקין עבור ${label} (#${c + 1}): ספרות בלבד`
          );
          return;
        }
        if (serialCodes.some((existing) => existing.localeCompare(raw, undefined, { sensitivity: 'accent' }) === 0)) {
          this.toast.error(`קוד כפול עבור ${label}: ${raw}`);
          return;
        }
        serialCodes.push(raw);
      }

      payloads.push({ id, codes: serialCodes, label, linked });
    }

    this.accessorySaving.set(true);
    this.data
      .updateInventoryDefinitionsBatch({
        items: payloads.map((p) => ({ id: p.id, serialCodes: p.codes }))
      })
      .pipe(finalize(() => this.accessorySaving.set(false)))
      .subscribe({
        next: (results) => {
          if (results === null) {
            return;
          }
          this.toast.success('מלאי הפריטים נשמר');
          this.loadAccessoryInventory();
        }
      });
  }

  private buildAccessoryRow(type: LoanedEquipmentType): FormGroup {
    return this.fb.group({
      equipmentType: this.fb.nonNullable.control(type),
      quantity: this.fb.control(0, [Validators.min(0)]),
      codes: this.fb.array<FormControl<string>>([])
    });
  }

  private wireAccessoryQuantitySync(): void {
    this.accessoryRows().controls.forEach((control) => {
      const group = control as FormGroup;
      const quantityCtrl = group.get('quantity');
      if (!quantityCtrl) {
        return;
      }

      quantityCtrl.valueChanges
        .pipe(
          startWith(quantityCtrl.value),
          map((value) => this.toNonNegativeInteger(value)),
          distinctUntilChanged(),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe((quantity) => this.setAccessoryCodesLength(group, quantity));
    });
  }

  private setAccessoryCodesLength(group: FormGroup, target: number): void {
    const length = this.toNonNegativeInteger(target);
    const codes = group.get('codes') as FormArray<FormControl<string>> | null;
    if (!codes) {
      return;
    }
    while (codes.length < length) {
      codes.push(this.fb.nonNullable.control(''));
    }
    while (codes.length > length) {
      codes.removeAt(codes.length - 1);
    }
  }

  private isValidAccessorySerialCode(type: LoanedEquipmentType, code: string): boolean {
    if (type === LoanedEquipmentType.Microphone) {
      return /^[A-Za-z0-9\-]+$/.test(code);
    }
    return /^\d+$/.test(code);
  }

  private toNonNegativeInteger(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  }

  protected onMaintenanceToggle(row: EquipmentDefinitionDto, event: Event): void {
    const input = event.target as HTMLInputElement;
    const wantOn = input.checked;
    const wasOn = row.isUnderMaintenance === true;
    if (wantOn === wasOn) {
      return;
    }
    this.maintenanceTogglingId.set(row.id);
    this.data
      .patchEquipmentDefinitionMaintenance(row.id, wantOn)
      .pipe(finalize(() => this.maintenanceTogglingId.set(null)))
      .subscribe({
        next: (dto) => {
          if (!dto) {
            input.checked = wasOn;
            return;
          }
          this.store.applyMaintenancePatch(row.id, dto.isUnderMaintenance === true);
          this.maintenanceSync.notifyMaintenanceChanged();
        }
      });
  }

  protected addInventoryCodes(): FormArray<FormControl<string>> {
    return this.addInventoryForm.get('codes') as FormArray<FormControl<string>>;
  }

  protected addInventoryCodeIndices(): number[] {
    const len = this.addInventoryCodes().length;
    return Array.from({ length: len }, (_, i) => i);
  }

  protected showAddInventoryCodes(): boolean {
    return this.toNonNegativeInteger(this.addInventoryForm.controls.quantity.value) > 0;
  }

  protected openAddSlot(): void {
    this.resetAddSlotForm();
    this.addSlotOpen.set(true);
  }

  protected closeAddSlot(): void {
    this.addSlotOpen.set(false);
  }

  protected openAddInventoryItem(): void {
    this.resetAddInventoryForm();
    this.addInventoryOpen.set(true);
  }

  protected closeAddInventoryItem(): void {
    this.addInventoryOpen.set(false);
  }

  protected autoFillInventoryCodes(): void {
    const codes = this.addInventoryCodes();
    if (codes.length === 0) {
      return;
    }

    let next = 1;
    const used = new Set(
      codes.controls
        .map((c) => String(c.value ?? '').trim())
        .filter((c) => c.length > 0)
        .map((c) => c.toLowerCase())
    );

    for (let i = 0; i < codes.length; i++) {
      const current = String(codes.at(i).value ?? '').trim();
      if (current.length > 0) {
        continue;
      }
      while (used.has(String(next))) {
        next++;
      }
      const fallback = String(next);
      used.add(fallback);
      codes.at(i).setValue(fallback);
      next++;
    }
  }

  protected focusNextAddInventoryCode(event: Event): void {
    this.focusNextCodeInput(event, 'input.add-inventory-code-input[data-serial-nav="inv"]');
  }

  private focusNextCodeInput(event: Event, selector: string): void {
    event.preventDefault();
    event.stopPropagation();

    const current = event.target;
    if (!(current instanceof HTMLInputElement)) {
      return;
    }

    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(selector));
    const index = inputs.indexOf(current);
    if (index < 0 || index >= inputs.length - 1) {
      return;
    }

    const next = inputs[index + 1];
    next.focus();
    next.select();
  }

  protected submitAddSlot(): void {
    if (this.addSlotForm.invalid) {
      this.addSlotForm.markAllAsTouched();
      this.toast.error('אנא תקנו את השדות המסומנים');
      return;
    }

    const displayName = (this.addSlotForm.controls.displayName.value ?? '').trim();
    const code = (this.addSlotForm.controls.code.value ?? '').trim();

    this.saving.set(true);
    this.data
      .createEquipmentDefinitionsBatch({
        displayName,
        category: 'Speakers',
        itemCodes: [code]
      })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (created) => {
          if (created === null) {
            return;
          }
          this.toast.success('הרמקול נוסף בהצלחה');
          this.store.upsertDefinitions(created);
          this.closeAddSlot();
          this.resetAddSlotForm();
        }
      });
  }

  protected submitAddInventoryItem(): void {
    if (this.addInventoryForm.invalid) {
      this.addInventoryForm.markAllAsTouched();
      this.toast.error('אנא תקנו את השדות המסומנים');
      return;
    }

    const displayName = (this.addInventoryForm.controls.displayName.value ?? '').trim();
    if (!displayName) {
      this.addInventoryForm.controls.displayName.markAsTouched();
      this.toast.error('יש להזין שם פריט');
      return;
    }

    const quantity = this.toNonNegativeInteger(this.addInventoryForm.controls.quantity.value);
    const rawCodes =
      quantity > 0
        ? this.addInventoryCodes().controls.map((c) => String(c.value ?? '').trim())
        : [];

    // Duplicates among filled codes only — blanks are filled by the API.
    const filled = rawCodes.filter((c) => c.length > 0);
    const unique = new Set(filled.map((c) => c.toLowerCase()));
    if (unique.size !== filled.length) {
      this.toast.error('קיימים קודי פריט כפולים בטופס');
      return;
    }

    this.inventorySaving.set(true);
    this.data
      .createInventoryDefinition({
        displayName,
        quantity,
        serialCodes: rawCodes
      })
      .pipe(finalize(() => this.inventorySaving.set(false)))
      .subscribe({
        next: (created) => {
          if (created === null) {
            return;
          }
          this.toast.success(`הפריט "${created.displayName}" נוסף למלאי`);
          this.closeAddInventoryItem();
          this.resetAddInventoryForm();
          this.loadAccessoryInventory();
        }
      });
  }

  private wireAddInventoryQuantitySync(): void {
    this.addInventoryForm.controls.quantity.valueChanges
      .pipe(
        startWith(this.addInventoryForm.controls.quantity.value),
        map((v) => this.toNonNegativeInteger(v)),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((qty) => this.setAddInventoryCodesLength(qty));
  }

  private setAddInventoryCodesLength(target: number): void {
    const length = Math.min(200, Math.max(0, target));
    const codes = this.addInventoryCodes();
    while (codes.length < length) {
      // Optional serial codes — blank allowed; server generates sequential fallbacks.
      codes.push(this.fb.nonNullable.control('', [Validators.maxLength(100)]));
    }
    while (codes.length > length) {
      codes.removeAt(codes.length - 1);
    }
  }

  private resetAddSlotForm(): void {
    this.addSlotForm.reset({
      displayName: '',
      code: ''
    });
  }

  private resetAddInventoryForm(): void {
    this.addInventoryForm.reset({
      displayName: '',
      quantity: 0
    });
    this.setAddInventoryCodesLength(0);
  }

  protected rows(): EquipmentDefinitionDto[] {
    return this.store.definitions();
  }

  protected openEdit(row: EquipmentDefinitionDto): void {
    this.editingId.set(row.id);
    this.editForm.reset({
      displayName: row.displayName,
      sortOrder: row.sortOrder
    });
    this.editOpen.set(true);
  }

  protected closeEdit(): void {
    this.editOpen.set(false);
    this.editingId.set(null);
  }

  protected saveEdit(): void {
    const id = this.editingId();
    if (!id) {
      return;
    }
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      this.toast.error('אנא תקנו את השדות המסומנים');
      return;
    }

    const v = this.editForm.getRawValue();
    const sortOrder = Number(v.sortOrder);
    if (!Number.isFinite(sortOrder)) {
      this.toast.error('סדר חייב להיות מספר שלם');
      return;
    }

    this.editSaving.set(true);
    this.data
      .updateEquipmentDefinition(id, {
        displayName: (v.displayName ?? '').trim(),
        sortOrder: Math.trunc(sortOrder)
      })
      .pipe(finalize(() => this.editSaving.set(false)))
      .subscribe({
        next: (updated) => {
          if (updated === null) {
            return;
          }
          this.toast.success('התא עודכן');
          this.store.upsertDefinition(updated);
          this.closeEdit();
        }
      });
  }

  protected deleteRow(row: EquipmentDefinitionDto): void {
    if (
      !confirm(
        'שימי לב: מחיקת התא תמחק לצמיתות את כל היסטוריית ההזמנות הישנות המשויכות אליו. האם להמשיך?'
      )
    ) {
      return;
    }
    this.deletingId.set(row.id);
    this.data.deleteEquipmentDefinition(row.id).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.toast.success('התא נמחק');
        this.store.removeDefinition(row.id);
      },
      error: (err: unknown) => {
        this.deletingId.set(null);
        const blocked = this.parseFutureOrdersBlock(err);
        if (blocked) {
          this.futureOrdersModal.set(blocked);
          return;
        }
        this.toast.error(this.deleteEquipmentErrorMessage(err));
      }
    });
  }

  protected closeFutureOrdersModal(): void {
    this.futureOrdersModal.set(null);
  }

  protected openOrderEditInNewTab(orderId: number): void {
    const returnUrl = '/admin/equipment-slots';
    const q = new URLSearchParams({ returnUrl });
    const url = `${window.location.origin}/orders/${orderId}?${q.toString()}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  protected formatBlockingOrderDate(orderDate: string): string {
    const s = orderDate.trim();
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
    if (Number.isNaN(d.getTime())) {
      return orderDate;
    }
    return d.toLocaleDateString('he-IL', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  private parseFutureOrdersBlock(err: unknown): EquipmentDefinitionDeleteFutureOrder[] | null {
    if (!(err instanceof HttpErrorResponse) || err.status !== 400) {
      return null;
    }
    const body = err.error;
    if (!body || typeof body !== 'object') {
      return null;
    }
    const raw = (body as { futureOrders?: unknown }).futureOrders;
    if (!Array.isArray(raw) || raw.length === 0) {
      return null;
    }
    const out: EquipmentDefinitionDeleteFutureOrder[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const r = item as Record<string, unknown>;
      const orderId = Number(r['orderId']);
      if (!Number.isFinite(orderId)) {
        continue;
      }
      const cn = r['customerName'];
      const customerName =
        cn === null || cn === undefined
          ? null
          : typeof cn === 'string'
            ? cn
            : String(cn);
      let orderDate = '';
      const od = r['orderDate'];
      if (typeof od === 'string') {
        orderDate = od;
      } else if (od && typeof od === 'object' && 'year' in od) {
        const y = (od as { year?: unknown }).year;
        const m = (od as { month?: unknown }).month;
        const day = (od as { day?: unknown }).day;
        if (typeof y === 'number' && typeof m === 'number' && typeof day === 'number') {
          orderDate = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }
      if (!orderDate) {
        continue;
      }
      out.push({ orderId, customerName, orderDate });
    }
    const todayYmd = this.todayIsraelYmd();
    const futureOnly = out
      .map((o) => {
        const ymd = this.normalizeOrderDateYmd(o.orderDate);
        return ymd ? { ...o, orderDate: ymd } : null;
      })
      .filter(
        (o): o is EquipmentDefinitionDeleteFutureOrder =>
          o !== null && o.orderDate >= todayYmd
      )
      .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.orderId - b.orderId);
    return futureOnly.length > 0 ? futureOnly : null;
  }

  /** Same calendar day rule as the API (Asia/Jerusalem), YYYY-MM-DD for string compare. */
  private todayIsraelYmd(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' });
  }

  private normalizeOrderDateYmd(raw: string): string | null {
    const s = raw.trim();
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    return m ? m[1] : null;
  }

  private deleteEquipmentErrorMessage(err: unknown): string {
    const fallback = 'שגיאה במחיקה';
    if (!(err instanceof HttpErrorResponse)) {
      return fallback;
    }
    const body = err.error;
    if (body && typeof body === 'object' && 'message' in body) {
      const m = (body as { message: unknown }).message;
      if (typeof m === 'string' && m.trim().length > 0) {
        return m.trim();
      }
    }
    if (typeof body === 'string' && body.trim().length > 0) {
      return body.trim();
    }
    if (err.status === 400) {
      return 'לא ניתן למחוק את התא';
    }
    return fallback;
  }
}
