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
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { finalize } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import {
  ToolDefinitionDto,
  ToolSerialLocationDto,
  ToolTypeLocationDto,
  toolDefinitionRequiresCode
} from '../../core/models/tools-workspace.model';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToolDefinitionsStore } from '../../core/services/tool-definitions.store';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import { sortNumericCodes } from '../../core/utils/numeric-code-sort';
import { IntegerOnlyDirective } from '../../shared/directives/integer-only.directive';
import { ToolTypeSelectComponent } from '../../shared/components/tool-type-select.component';

@Component({
  selector: 'app-tools-inventory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, IntegerOnlyDirective, ToolTypeSelectComponent],
  templateUrl: './tools-inventory.component.html',
  styleUrl: './tools-inventory.component.scss'
})
export class ToolsInventoryComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly toolStore = inject(ToolDefinitionsStore);
  private readonly toast = inject(ToastService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly pageTitle = inject(WorkspaceUiService).title('ניהול מלאי');

  protected readonly loading = signal(true);
  protected readonly inventorySaving = signal(false);
  protected readonly serialSearchLoading = signal(false);
  protected readonly serialSearchAttempted = signal(false);
  protected readonly serialLocationResult = signal<ToolSerialLocationDto | null>(null);
  protected readonly typeLocationResult = signal<ToolTypeLocationDto | null>(null);
  /** Shared sorted catalog (A–Z) — same source as lending / returns. */
  protected readonly definitions = this.toolStore.definitions;

  protected readonly addInventoryOpen = signal(false);
  protected readonly editingInventoryRowId = signal<number | null>(null);
  protected readonly savingInventoryRowId = signal<number | null>(null);
  protected readonly deletingInventoryId = signal<number | null>(null);

  private readonly inventoryRowSnapshots = new Map<
    number,
    { displayName: string; quantity: number; requiresCode: boolean; codes: string[] }
  >();

  protected readonly inventoryForm = this.fb.group({
    rows: this.fb.array<FormGroup>([])
  });

  protected readonly serialSearchForm = this.fb.group({
    toolDefinitionId: this.fb.nonNullable.control<number | null>(null),
    serialCode: ['']
  });

  protected readonly addInventoryForm = this.fb.group({
    displayName: ['', [Validators.required, Validators.maxLength(200)]],
    quantity: [0 as number | null, [Validators.min(0), Validators.max(200)]],
    requiresCode: this.fb.nonNullable.control(true),
    codes: this.fb.array<FormControl<string>>([])
  });

  ngOnInit(): void {
    this.wireAddInventoryQuantitySync();
    this.wireAddInventoryRequiresCodeSync();
    this.wireSerialSearchTypeFilter();
    this.refresh();
  }

  protected inventoryRows(): FormArray {
    return this.inventoryForm.get('rows') as FormArray;
  }

  protected inventoryRowGroup(index: number): FormGroup {
    return this.inventoryRows().at(index) as FormGroup;
  }

  protected inventoryCodesArray(rowIndex: number): FormArray<FormControl<string>> {
    return this.inventoryRowGroup(rowIndex).get('codes') as FormArray<FormControl<string>>;
  }

  protected codeIndicesForRow(rowIndex: number): number[] {
    const len = this.inventoryCodesArray(rowIndex).length;
    return Array.from({ length: len }, (_, i) => i);
  }

  protected isInventoryRowEditing(defId: number): boolean {
    return this.editingInventoryRowId() === defId;
  }

  protected selectedSearchDefinition(): ToolDefinitionDto | null {
    const id = this.serialSearchForm.controls.toolDefinitionId.value;
    if (id == null) {
      return null;
    }
    return this.definitions().find((d) => d.id === id) ?? null;
  }

  protected selectedSearchRequiresCode(): boolean {
    return toolDefinitionRequiresCode(this.selectedSearchDefinition());
  }

  protected serialCodesForSearchType(): string[] {
    const id = this.serialSearchForm.controls.toolDefinitionId.value;
    if (id == null) {
      return sortNumericCodes(this.definitions().flatMap((d) => d.serialCodes));
    }
    return sortNumericCodes(this.definitions().find((d) => d.id === id)?.serialCodes ?? []);
  }

  protected refresh(): void {
    this.loading.set(true);
    this.editingInventoryRowId.set(null);
    this.inventoryRowSnapshots.clear();
    this.toolStore.invalidate();
    this.toolStore
      .load({ force: true })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe(() => {
        const list = this.toolStore.definitions();
        this.rebuildRows(list);
        if (list.length > 0 && this.serialSearchForm.controls.toolDefinitionId.value == null) {
          this.serialSearchForm.patchValue({ toolDefinitionId: list[0]!.id });
        } else {
          this.syncSerialSearchCodeEnabled(this.serialSearchForm.controls.toolDefinitionId.value);
        }
      });
  }

  protected searchSerialLocation(): void {
    const toolDefinitionId = this.serialSearchForm.controls.toolDefinitionId.value;
    const serialCode = (this.serialSearchForm.controls.serialCode.value ?? '').trim();
    if (toolDefinitionId == null) {
      this.toast.error('יש לבחור סוג כלי לחיפוש');
      return;
    }

    const def = this.definitions().find((d) => d.id === toolDefinitionId);
    if (!toolDefinitionRequiresCode(def)) {
      this.serialSearchLoading.set(true);
      this.serialSearchAttempted.set(true);
      this.serialLocationResult.set(null);
      this.data
        .locateToolByType(toolDefinitionId)
        .pipe(finalize(() => this.serialSearchLoading.set(false)))
        .subscribe((result) => {
          if (result) {
            this.typeLocationResult.set(result);
          }
        });
      return;
    }

    if (!serialCode) {
      this.serialSearchForm.controls.serialCode.markAsTouched();
      this.toast.error('יש לבחור קוד פריט לחיפוש');
      return;
    }

    this.serialSearchLoading.set(true);
    this.serialSearchAttempted.set(true);
    this.typeLocationResult.set(null);
    this.data
      .locateToolSerial(serialCode, toolDefinitionId)
      .pipe(finalize(() => this.serialSearchLoading.set(false)))
      .subscribe((result) => {
        if (result) {
          this.serialLocationResult.set(result);
        }
      });
  }

  protected clearSerialSearch(): void {
    this.serialSearchAttempted.set(false);
    this.serialLocationResult.set(null);
    this.typeLocationResult.set(null);
    this.serialSearchForm.patchValue({ serialCode: '' });
  }

  protected formatLocatorPhone(phone: string | null | undefined): string {
    const digits = (phone ?? '').replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone ?? '';
  }

  /** Hebrew calendar date for a loaned-item locator card. */
  protected formatLocatorHebrewDate(
    hebrewLentDisplay: string | null | undefined,
    loanDate: string | null | undefined
  ): string {
    const stored = (hebrewLentDisplay ?? '').trim();
    if (stored) {
      const withoutTime = stored.replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*$/, '').trim();
      if (withoutTime) {
        return withoutTime;
      }
    }
    const iso = (loanDate ?? '').trim();
    if (!iso) {
      return '—';
    }
    const date = this.hebrew.parseIso(iso);
    return date ? this.hebrew.toHebrew(date) : '—';
  }

  protected openAddInventoryItem(): void {
    this.addInventoryForm.reset({ displayName: '', quantity: 0, requiresCode: true });
    this.addInventoryCodes().clear();
    this.addInventoryOpen.set(true);
  }

  protected closeAddInventoryItem(): void {
    this.addInventoryOpen.set(false);
  }

  protected showAddInventoryCodes(): boolean {
    return (
      this.addInventoryForm.controls.requiresCode.value !== false &&
      this.toNonNegativeInteger(this.addInventoryForm.controls.quantity.value) > 0
    );
  }

  protected addInventoryCodes(): FormArray<FormControl<string>> {
    return this.addInventoryForm.get('codes') as FormArray<FormControl<string>>;
  }

  protected addInventoryCodeIndices(): number[] {
    return Array.from({ length: this.addInventoryCodes().length }, (_, i) => i);
  }

  protected autoFillInventoryCodes(): void {
    const codes = this.addInventoryCodes();
    for (let i = 0; i < codes.length; i++) {
      if (!String(codes.at(i).value ?? '').trim()) {
        codes.at(i).setValue(String(i + 1));
      }
    }
  }

  protected focusNextSerialInput(event: Event): void {
    const current = event.target as HTMLInputElement | null;
    if (!current) {
      return;
    }
    event.preventDefault();
    const nodes = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[data-serial-nav="1"]')
    );
    const idx = nodes.indexOf(current);
    if (idx >= 0 && idx < nodes.length - 1) {
      nodes[idx + 1]?.focus();
    }
  }

  protected focusNextAddInventoryCode(event: Event): void {
    const current = event.target as HTMLInputElement | null;
    if (!current) {
      return;
    }
    event.preventDefault();
    const nodes = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[data-serial-nav="inv"]')
    );
    const idx = nodes.indexOf(current);
    if (idx >= 0 && idx < nodes.length - 1) {
      nodes[idx + 1]?.focus();
    }
  }

  protected submitAddInventoryItem(): void {
    if (this.addInventoryForm.invalid) {
      this.addInventoryForm.markAllAsTouched();
      return;
    }

    const displayName = (this.addInventoryForm.controls.displayName.value ?? '').trim();
    const quantity = this.toNonNegativeInteger(this.addInventoryForm.controls.quantity.value);
    const requiresCode = this.addInventoryForm.controls.requiresCode.value !== false;
    const serialCodes = requiresCode
      ? this.addInventoryCodes()
          .controls.map((c) => String(c.value ?? '').trim())
          .filter((c) => c.length > 0)
      : [];

    this.inventorySaving.set(true);
    this.data
      .createToolDefinition({ displayName, quantity, requiresCode, serialCodes })
      .pipe(finalize(() => this.inventorySaving.set(false)))
      .subscribe((created) => {
        if (!created) {
          return;
        }
        this.toast.success('הפריט נוסף למלאי');
        this.closeAddInventoryItem();
        this.refresh();
      });
  }

  protected startEditInventoryRow(def: ToolDefinitionDto, rowIndex: number): void {
    const currentEdit = this.editingInventoryRowId();
    if (currentEdit != null && currentEdit !== def.id) {
      this.toast.warning('יש לשמור או לבטל את העריכה הנוכחית תחילה');
      return;
    }

    const group = this.inventoryRowGroup(rowIndex);
    const codes = this.inventoryCodesArray(rowIndex).controls.map((c) =>
      String(c.value ?? '').trim()
    );
    this.inventoryRowSnapshots.set(def.id, {
      displayName: String(group.get('displayName')?.value ?? ''),
      quantity: this.toNonNegativeInteger(group.get('quantity')?.value),
      requiresCode: group.get('requiresCode')?.value !== false,
      codes: [...codes]
    });
    this.setInventoryRowEditable(rowIndex, true);
    this.editingInventoryRowId.set(def.id);
  }

  protected cancelEditInventoryRow(def: ToolDefinitionDto, rowIndex: number): void {
    const snap = this.inventoryRowSnapshots.get(def.id);
    if (snap) {
      const group = this.inventoryRowGroup(rowIndex);
      group.patchValue(
        {
          displayName: snap.displayName,
          quantity: snap.quantity,
          requiresCode: snap.requiresCode
        },
        { emitEvent: false }
      );
      this.setCodesLength(group, snap.requiresCode ? snap.quantity : 0);
      const codesFa = this.inventoryCodesArray(rowIndex);
      for (let i = 0; i < codesFa.length; i++) {
        codesFa.at(i).setValue(snap.codes[i] ?? '', { emitEvent: false });
      }
    }
    this.setInventoryRowEditable(rowIndex, false);
    this.editingInventoryRowId.set(null);
    this.inventoryRowSnapshots.delete(def.id);
  }

  protected saveInventoryRow(def: ToolDefinitionDto, rowIndex: number): void {
    const group = this.inventoryRowGroup(rowIndex);
    const displayName = String(group.get('displayName')?.value ?? '').trim();
    if (!displayName) {
      this.toast.error('יש להזין שם פריט');
      return;
    }

    const requiresCode = group.get('requiresCode')?.value !== false;
    const quantity = this.toNonNegativeInteger(group.get('quantity')?.value);
    const codesFa = this.inventoryCodesArray(rowIndex);
    const serialCodes: string[] = [];

    if (requiresCode) {
      for (let c = 0; c < codesFa.length; c++) {
        const raw = String(codesFa.at(c).value ?? '').trim();
        if (raw.length === 0) {
          this.toast.error(`יש להזין קוד פריט עבור ${displayName} (#${c + 1})`);
          return;
        }
        if (
          serialCodes.some(
            (existing) => existing.localeCompare(raw, undefined, { sensitivity: 'accent' }) === 0
          )
        ) {
          this.toast.error(`קוד כפול עבור ${displayName}: ${raw}`);
          return;
        }
        serialCodes.push(raw);
      }
    }

    this.savingInventoryRowId.set(def.id);
    this.data
      .updateToolDefinitionsBatch({
        items: [
          {
            id: def.id,
            displayName,
            requiresCode,
            quantity,
            serialCodes
          }
        ]
      })
      .pipe(finalize(() => this.savingInventoryRowId.set(null)))
      .subscribe((results) => {
        if (results === null || results.length === 0) {
          return;
        }
        const updated = results[0]!;
        this.toast.success('הפריט נשמר');
        this.toolStore.upsert(updated);
        const rows = this.inventoryRows();
        for (let i = 0; i < rows.length; i++) {
          if (Number((rows.at(i) as FormGroup).get('id')?.value) === updated.id) {
            const rebuilt = this.buildRow(updated);
            rows.setControl(i, rebuilt);
            this.wireRowQuantitySync(rebuilt);
            break;
          }
        }
        this.editingInventoryRowId.set(null);
        this.inventoryRowSnapshots.delete(def.id);
      });
  }

  protected deleteInventoryItem(def: ToolDefinitionDto): void {
    if (this.editingInventoryRowId() != null) {
      this.toast.warning('יש לשמור או לבטל את העריכה הנוכחית תחילה');
      return;
    }
    if (!confirm(`למחוק את "${def.displayName}" מהמלאי?`)) {
      return;
    }
    this.deletingInventoryId.set(def.id);
    this.data
      .deleteToolDefinition(def.id)
      .pipe(finalize(() => this.deletingInventoryId.set(null)))
      .subscribe((ok) => {
        if (!ok) {
          return;
        }
        this.toast.success('הפריט נמחק');
        this.refresh();
      });
  }

  private rebuildRows(defs: ToolDefinitionDto[]): void {
    const rows = this.inventoryRows();
    rows.clear();
    for (const def of defs) {
      const group = this.buildRow(def);
      rows.push(group);
      this.wireRowQuantitySync(group);
    }
  }

  private buildRow(def: ToolDefinitionDto): FormGroup {
    const requiresCode = toolDefinitionRequiresCode(def);
    const quantity = requiresCode
      ? Math.max(def.totalQuantity ?? 0, def.serialCodes.length)
      : Math.max(0, def.totalQuantity ?? 0);
    const codeValues = requiresCode ? def.serialCodes : [];
    const codes = this.fb.array<FormControl<string>>(
      codeValues.map((code) =>
        this.fb.nonNullable.control(
          { value: code, disabled: true },
          [Validators.maxLength(100)]
        )
      )
    );
    while (requiresCode && codes.length < quantity) {
      codes.push(
        this.fb.nonNullable.control({ value: '', disabled: true }, [Validators.maxLength(100)])
      );
    }
    return this.fb.group({
      id: this.fb.nonNullable.control(def.id),
      displayName: this.fb.nonNullable.control(
        { value: def.displayName, disabled: true },
        [Validators.required, Validators.maxLength(200)]
      ),
      quantity: this.fb.control({ value: quantity, disabled: true }, [Validators.min(0)]),
      requiresCode: this.fb.nonNullable.control({ value: requiresCode, disabled: true }),
      codes
    });
  }

  private setInventoryRowEditable(rowIndex: number, editable: boolean): void {
    const group = this.inventoryRowGroup(rowIndex);
    const toggle = (ctrl: AbstractControl | null | undefined) => {
      if (!ctrl) {
        return;
      }
      if (editable) {
        ctrl.enable({ emitEvent: false });
      } else {
        ctrl.disable({ emitEvent: false });
      }
    };
    toggle(group.get('displayName'));
    toggle(group.get('quantity'));
    toggle(group.get('requiresCode'));
    this.inventoryCodesArray(rowIndex).controls.forEach((c) => toggle(c));
  }

  private wireRowQuantitySync(group: FormGroup): void {
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
      .subscribe((quantity) => {
        if (group.get('requiresCode')?.value === false) {
          this.setCodesLength(group, 0);
          return;
        }
        this.setCodesLength(group, quantity);
      });

    const requiresCtrl = group.get('requiresCode');
    if (!requiresCtrl) {
      return;
    }
    requiresCtrl.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((requiresCode) => {
        if (requiresCode === false) {
          this.setCodesLength(group, 0);
          return;
        }
        this.setCodesLength(group, this.toNonNegativeInteger(group.get('quantity')?.value));
      });
  }

  private setCodesLength(group: FormGroup, target: number): void {
    const length = this.toNonNegativeInteger(target);
    const codes = group.get('codes') as FormArray<FormControl<string>> | null;
    if (!codes) {
      return;
    }
    const editable = group.get('quantity')?.enabled === true;
    while (codes.length < length) {
      const ctrl = this.fb.nonNullable.control('', [Validators.maxLength(100)]);
      if (!editable) {
        ctrl.disable({ emitEvent: false });
      }
      codes.push(ctrl);
    }
    while (codes.length > length) {
      codes.removeAt(codes.length - 1);
    }
  }

  private wireAddInventoryQuantitySync(): void {
    this.addInventoryForm.controls.quantity.valueChanges
      .pipe(
        map((value) => this.toNonNegativeInteger(value)),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((quantity) => {
        if (this.addInventoryForm.controls.requiresCode.value === false) {
          this.addInventoryCodes().clear();
          return;
        }
        const codes = this.addInventoryCodes();
        while (codes.length < quantity) {
          codes.push(this.fb.nonNullable.control('', [Validators.maxLength(100)]));
        }
        while (codes.length > quantity) {
          codes.removeAt(codes.length - 1);
        }
      });
  }

  private wireAddInventoryRequiresCodeSync(): void {
    this.addInventoryForm.controls.requiresCode.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((requiresCode) => {
        if (requiresCode === false) {
          this.addInventoryCodes().clear();
          return;
        }
        const quantity = this.toNonNegativeInteger(this.addInventoryForm.controls.quantity.value);
        const codes = this.addInventoryCodes();
        while (codes.length < quantity) {
          codes.push(this.fb.nonNullable.control('', [Validators.maxLength(100)]));
        }
        while (codes.length > quantity) {
          codes.removeAt(codes.length - 1);
        }
      });
  }

  private wireSerialSearchTypeFilter(): void {
    this.serialSearchForm.controls.toolDefinitionId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((toolDefinitionId) => {
        this.serialSearchForm.patchValue({ serialCode: '' }, { emitEvent: false });
        this.serialLocationResult.set(null);
        this.typeLocationResult.set(null);
        this.serialSearchAttempted.set(false);
        this.syncSerialSearchCodeEnabled(toolDefinitionId);
      });
  }

  private syncSerialSearchCodeEnabled(toolDefinitionId: number | null): void {
    const def =
      toolDefinitionId == null
        ? null
        : this.definitions().find((d) => d.id === toolDefinitionId) ?? null;
    if (toolDefinitionRequiresCode(def)) {
      this.serialSearchForm.controls.serialCode.enable({ emitEvent: false });
    } else {
      this.serialSearchForm.controls.serialCode.disable({ emitEvent: false });
    }
  }

  private toNonNegativeInteger(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      return 0;
    }
    return Math.min(200, Math.floor(n));
  }
}
