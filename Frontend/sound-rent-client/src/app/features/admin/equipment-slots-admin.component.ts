import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, effect, inject, signal, untracked } from '@angular/core';
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
import { LOANED_EQUIPMENT_LABELS, LOANED_EQUIPMENT_ORDER, LoanedEquipmentType } from '../../core/models/enums';
import { DataService } from '../../core/services/data.service';
import { EquipmentDefinitionsStore } from '../../core/services/equipment-definitions.store';
import { EquipmentMaintenanceSyncService } from '../../core/services/equipment-maintenance-sync.service';
import { ToastService } from '../../core/services/toast.service';
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
  private readonly maintenanceSync = inject(EquipmentMaintenanceSyncService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly accessoryRowDefinitions = LOANED_EQUIPMENT_ORDER.map((type) => ({
    type,
    label: LOANED_EQUIPMENT_LABELS[type]
  }));
  protected readonly accessoryLoading = signal(true);
  protected readonly accessorySaving = signal(false);
  protected readonly serialSearchLoading = signal(false);
  protected readonly serialLocationResult = signal<AccessorySerialLocationDto | null>(null);
  protected readonly serialSearchAttempted = signal(false);
  private readonly accessoryCodesByType = signal<Map<LoanedEquipmentType, string[]>>(new Map());

  protected readonly serialSearchForm = this.fb.group({
    equipmentType: this.fb.nonNullable.control<LoanedEquipmentType>(LOANED_EQUIPMENT_ORDER[0]!),
    serialCode: ['', Validators.required]
  });

  protected readonly accessoryForm = this.fb.group({
    rows: this.fb.array(LOANED_EQUIPMENT_ORDER.map((type) => this.buildAccessoryRow(type)))
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
  protected readonly editSaving = signal(false);
  protected readonly editOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly deletingId = signal<string | null>(null);
  protected readonly futureOrdersModal = signal<EquipmentDefinitionDeleteFutureOrder[] | null>(null);
  protected readonly maintenanceTogglingId = signal<string | null>(null);

  protected readonly addForm = this.fb.group({
    id: ['', [Validators.required, Validators.maxLength(64), Validators.pattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)]],
    displayName: ['', [Validators.required, Validators.maxLength(200)]],
    category: ['Speakers', Validators.required]
  });

  protected readonly editForm = this.fb.group({
    displayName: ['', [Validators.required, Validators.maxLength(200)]],
    sortOrder: [0, [Validators.required, Validators.min(0), Validators.max(1_000_000)]]
  });

  ngOnInit(): void {
    this.wireAccessoryQuantitySync();
    this.wireSerialSearchTypeFilter();
    this.refresh();
  }

  protected serialCodesForSearchType(): string[] {
    const type = this.serialSearchForm.controls.equipmentType.value;
    return this.accessoryCodesByType().get(type) ?? [];
  }

  protected searchSerialLocation(): void {
    const type = this.serialSearchForm.controls.equipmentType.value;
    const serialCode = (this.serialSearchForm.controls.serialCode.value ?? '').trim();
    if (!serialCode) {
      this.serialSearchForm.controls.serialCode.markAsTouched();
      this.toast.error('יש לבחור קוד פריט לחיפוש');
      return;
    }

    this.serialSearchLoading.set(true);
    this.serialSearchAttempted.set(true);
    this.data
      .getAccessorySerialLocation(type, serialCode)
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

  protected refresh(): void {
    this.store.invalidate();
    this.store.load().subscribe();
    this.loadAccessoryInventory();
  }

  protected loadAccessoryInventory(): void {
    this.accessoryLoading.set(true);
    this.data
      .getAccessoryInventory()
      .pipe(finalize(() => this.accessoryLoading.set(false)))
      .subscribe((groups) => {
        const byType = new Map<LoanedEquipmentType, string[]>();
        for (const group of groups) {
          const codes = (group.serialCodes ?? []).map((c) => c.trim()).filter((c) => c.length > 0);
          byType.set(group.equipmentType, codes);
        }
        this.accessoryCodesByType.set(byType);
        this.accessoryRows().controls.forEach((control, idx) => {
          const type = LOANED_EQUIPMENT_ORDER[idx]!;
          const codes = byType.get(type) ?? [];
          const group = control as FormGroup;
          group.patchValue({ quantity: codes.length }, { emitEvent: false });
          this.setAccessoryCodesLength(group, codes.length);
          const codesFa = this.accessoryCodesArray(idx);
          codes.forEach((code, i) => codesFa.at(i).setValue(code, { emitEvent: false }));
        });
      });
  }

  private wireSerialSearchTypeFilter(): void {
    this.serialSearchForm.controls.equipmentType.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.serialSearchForm.patchValue({ serialCode: '' }, { emitEvent: false });
        this.serialLocationResult.set(null);
        this.serialSearchAttempted.set(false);
      });
  }

  protected saveAccessoryInventory(): void {
    const payloads: { type: LoanedEquipmentType; codes: string[]; label: string }[] = [];

    for (let i = 0; i < this.accessoryRows().length; i++) {
      const group = this.accessoryRowGroup(i);
      const type = group.get('equipmentType')?.value as LoanedEquipmentType;
      const label = LOANED_EQUIPMENT_LABELS[type] ?? String(type);
      const codesFa = this.accessoryCodesArray(i);
      const serialCodes: string[] = [];

      for (let c = 0; c < codesFa.length; c++) {
        const raw = String(codesFa.at(c).value ?? '').trim();
        if (raw.length === 0) {
          this.toast.error(`יש להזין קוד פריט עבור ${label} (#${c + 1})`);
          return;
        }
        if (!this.isValidAccessorySerialCode(type, raw)) {
          this.toast.error(
            type === LoanedEquipmentType.Microphone
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

      payloads.push({ type, codes: serialCodes, label });
    }

    this.accessorySaving.set(true);
    this.data
      .updateAccessoryInventoryBatch({
        items: payloads.map((p) => ({
          equipmentType: p.type,
          serialCodes: p.codes
        }))
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

  protected submitAdd(): void {
    if (this.addForm.invalid) {
      this.addForm.markAllAsTouched();
      this.toast.error('אנא תקנו את השדות המסומנים');
      return;
    }

    const v = this.addForm.getRawValue();
    const defs = this.store.definitions();
    const nextOrder = defs.length === 0 ? 0 : Math.max(...defs.map((d) => d.sortOrder)) + 1;

    this.saving.set(true);
    this.data
      .createEquipmentDefinition({
        id: (v.id ?? '').trim(),
        displayName: (v.displayName ?? '').trim(),
        category: 'Speakers',
        sortOrder: nextOrder
      })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (created) => {
          if (created === null) {
            return;
          }
          this.toast.success('תא ההזמנה נוסף');
          this.addForm.reset({
            id: '',
            displayName: '',
            category: 'Speakers'
          });
          this.store.upsertDefinition(created);
        }
      });
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
