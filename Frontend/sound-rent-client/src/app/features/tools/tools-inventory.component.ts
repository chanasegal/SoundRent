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
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { finalize } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { ToolDefinitionDto, ToolSerialLocationDto } from '../../core/models/tools-workspace.model';
import { DataService } from '../../core/services/data.service';
import { ToolDefinitionsStore } from '../../core/services/tool-definitions.store';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
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
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly pageTitle = inject(WorkspaceUiService).title('ניהול מלאי');

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly inventorySaving = signal(false);
  protected readonly serialSearchLoading = signal(false);
  protected readonly serialSearchAttempted = signal(false);
  protected readonly serialLocationResult = signal<ToolSerialLocationDto | null>(null);
  /** Shared sorted catalog (A–Z) — same source as lending / returns. */
  protected readonly definitions = this.toolStore.definitions;

  protected readonly addInventoryOpen = signal(false);
  protected readonly editInventoryOpen = signal(false);
  protected readonly editInventorySaving = signal(false);
  protected readonly editingInventoryId = signal<number | null>(null);
  protected readonly deletingInventoryId = signal<number | null>(null);

  protected readonly inventoryForm = this.fb.group({
    rows: this.fb.array<FormGroup>([])
  });

  protected readonly serialSearchForm = this.fb.group({
    toolDefinitionId: this.fb.nonNullable.control<number | null>(null),
    serialCode: ['', Validators.required]
  });

  protected readonly addInventoryForm = this.fb.group({
    displayName: ['', [Validators.required, Validators.maxLength(200)]],
    quantity: [0 as number | null, [Validators.min(0), Validators.max(200)]],
    codes: this.fb.array<FormControl<string>>([])
  });

  protected readonly editInventoryForm = this.fb.group({
    displayName: ['', [Validators.required, Validators.maxLength(200)]]
  });

  ngOnInit(): void {
    this.wireAddInventoryQuantitySync();
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

  protected serialCodesForSearchType(): string[] {
    const id = this.serialSearchForm.controls.toolDefinitionId.value;
    if (id == null) {
      return this.definitions().flatMap((d) => d.serialCodes);
    }
    return this.definitions().find((d) => d.id === id)?.serialCodes ?? [];
  }

  protected refresh(): void {
    this.loading.set(true);
    this.toolStore.invalidate();
    this.toolStore
      .load({ force: true })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe(() => {
        const list = this.toolStore.definitions();
        this.rebuildRows(list);
        if (list.length > 0 && this.serialSearchForm.controls.toolDefinitionId.value == null) {
          this.serialSearchForm.patchValue({ toolDefinitionId: list[0]!.id });
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
    if (!serialCode) {
      this.serialSearchForm.controls.serialCode.markAsTouched();
      this.toast.error('יש לבחור קוד פריט לחיפוש');
      return;
    }

    this.serialSearchLoading.set(true);
    this.serialSearchAttempted.set(true);
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
    this.serialSearchForm.patchValue({ serialCode: '' });
  }

  protected formatLocatorPhone(phone: string | null | undefined): string {
    const digits = (phone ?? '').replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone ?? '';
  }

  protected openAddInventoryItem(): void {
    this.addInventoryForm.reset({ displayName: '', quantity: 0 });
    this.addInventoryCodes().clear();
    this.addInventoryOpen.set(true);
  }

  protected closeAddInventoryItem(): void {
    this.addInventoryOpen.set(false);
  }

  protected showAddInventoryCodes(): boolean {
    return this.toNonNegativeInteger(this.addInventoryForm.controls.quantity.value) > 0;
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
    const serialCodes = this.addInventoryCodes()
      .controls.map((c) => String(c.value ?? '').trim())
      .filter((c) => c.length > 0);

    this.inventorySaving.set(true);
    this.data
      .createToolDefinition({ displayName, quantity, serialCodes })
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

  protected openEditInventoryItem(def: ToolDefinitionDto): void {
    this.editingInventoryId.set(def.id);
    this.editInventoryForm.reset({ displayName: def.displayName });
    this.editInventoryOpen.set(true);
  }

  protected closeEditInventoryItem(): void {
    this.editInventoryOpen.set(false);
    this.editingInventoryId.set(null);
  }

  protected submitEditInventoryItem(): void {
    const id = this.editingInventoryId();
    if (id == null || this.editInventoryForm.invalid) {
      this.editInventoryForm.markAllAsTouched();
      return;
    }

    const displayName = (this.editInventoryForm.controls.displayName.value ?? '').trim();
    this.editInventorySaving.set(true);
    this.data
      .updateToolDefinition(id, { displayName })
      .pipe(finalize(() => this.editInventorySaving.set(false)))
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.toast.success('שם הפריט עודכן');
        this.closeEditInventoryItem();
        this.refresh();
      });
  }

  protected deleteInventoryItem(def: ToolDefinitionDto): void {
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

  protected saveInventory(): void {
    const items: { id: number; serialCodes: string[] }[] = [];

    for (let i = 0; i < this.inventoryRows().length; i++) {
      const group = this.inventoryRowGroup(i);
      const id = Number(group.get('id')?.value);
      const label = String(group.get('displayName')?.value ?? '');
      const codesFa = this.inventoryCodesArray(i);
      const serialCodes: string[] = [];

      for (let c = 0; c < codesFa.length; c++) {
        const raw = String(codesFa.at(c).value ?? '').trim();
        if (raw.length === 0) {
          this.toast.error(`יש להזין קוד פריט עבור ${label} (#${c + 1})`);
          return;
        }
        if (serialCodes.some((existing) => existing.localeCompare(raw, undefined, { sensitivity: 'accent' }) === 0)) {
          this.toast.error(`קוד כפול עבור ${label}: ${raw}`);
          return;
        }
        serialCodes.push(raw);
      }

      items.push({ id, serialCodes });
    }

    this.saving.set(true);
    this.data
      .updateToolDefinitionsBatch({ items })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe((results) => {
        if (results === null) {
          return;
        }
        this.toast.success('מלאי הכלים נשמר');
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
    const codes = this.fb.array<FormControl<string>>(
      def.serialCodes.map((code) => this.fb.nonNullable.control(code, [Validators.maxLength(100)]))
    );
    return this.fb.group({
      id: this.fb.nonNullable.control(def.id),
      displayName: this.fb.nonNullable.control(def.displayName),
      quantity: this.fb.control(def.serialCodes.length, [Validators.min(0)]),
      codes
    });
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
      .subscribe((quantity) => this.setCodesLength(group, quantity));
  }

  private setCodesLength(group: FormGroup, target: number): void {
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

  private wireAddInventoryQuantitySync(): void {
    this.addInventoryForm.controls.quantity.valueChanges
      .pipe(
        map((value) => this.toNonNegativeInteger(value)),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((quantity) => {
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
      .subscribe(() => {
        this.serialSearchForm.patchValue({ serialCode: '' }, { emitEvent: false });
        this.serialLocationResult.set(null);
        this.serialSearchAttempted.set(false);
      });
  }

  private toNonNegativeInteger(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      return 0;
    }
    return Math.min(200, Math.floor(n));
  }
}
