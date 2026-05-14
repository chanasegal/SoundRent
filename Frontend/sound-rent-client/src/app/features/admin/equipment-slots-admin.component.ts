import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, effect, inject, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin, finalize } from 'rxjs';

import {
  EquipmentDefinitionDeleteFutureOrder,
  EquipmentDefinitionDto
} from '../../core/models/equipment-definition.model';
import { LOANED_EQUIPMENT_LABELS, LOANED_EQUIPMENT_ORDER, LoanedEquipmentType } from '../../core/models/enums';
import { DataService } from '../../core/services/data.service';
import { EquipmentDefinitionsStore } from '../../core/services/equipment-definitions.store';
import { EquipmentMaintenanceSyncService } from '../../core/services/equipment-maintenance-sync.service';
import { LoanedEquipmentNoteDefaultsStore } from '../../core/services/loaned-equipment-note-defaults.store';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-equipment-slots-admin',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './equipment-slots-admin.component.html',
  styleUrl: './equipment-slots-admin.component.scss'
})
export class EquipmentSlotsAdminComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly store = inject(EquipmentDefinitionsStore);
  private readonly noteDefaults = inject(LoanedEquipmentNoteDefaultsStore);
  private readonly maintenanceSync = inject(EquipmentMaintenanceSyncService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

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
  protected readonly deletingId = signal<string | null>(null);
  protected readonly savingNoteType = signal<LoanedEquipmentType | null>(null);
  protected readonly futureOrdersModal = signal<EquipmentDefinitionDeleteFutureOrder[] | null>(null);
  protected readonly maintenanceTogglingId = signal<string | null>(null);

  protected readonly addForm = this.fb.group({
    id: ['', [Validators.required, Validators.maxLength(64), Validators.pattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)]],
    displayName: ['', [Validators.required, Validators.maxLength(200)]],
    category: ['Speakers', Validators.required]
  });

  ngOnInit(): void {
    this.refresh();
  }

  protected refresh(): void {
    forkJoin([this.store.load(), this.noteDefaults.load()]).subscribe();
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

  protected rows(): EquipmentDefinitionDto[] {
    return this.store.definitions();
  }

  protected noteDefaultRows(): Array<{ type: LoanedEquipmentType; label: string; count: number }> {
    const dm = new Map(this.noteDefaults.defaults().map((d) => [d.loanedEquipmentType, d.defaultNoteCount]));
    return LOANED_EQUIPMENT_ORDER.map((type) => ({
      type,
      label: LOANED_EQUIPMENT_LABELS[type],
      count: dm.get(type) ?? 1
    }));
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
          this.refresh();
        }
      });
  }

  protected saveNoteDefault(type: LoanedEquipmentType, raw: string): void {
    const n = Math.min(20, Math.max(0, Number(raw) || 0));
    this.savingNoteType.set(type);
    this.data
      .updateLoanedEquipmentNoteDefault(type, n)
      .pipe(finalize(() => this.savingNoteType.set(null)))
      .subscribe({
        next: (updated) => {
          if (updated === null) {
            return;
          }
          this.toast.success('ברירת המחדל עודכנה');
          this.noteDefaults.load().subscribe();
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
        this.refresh();
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
