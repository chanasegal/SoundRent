import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize } from 'rxjs';

import {
  LOST_EQUIPMENT_STATUS_LABELS,
  LostEquipmentDto,
  LostEquipmentStatus
} from '../../core/models/lost-equipment.model';
import { DataService } from '../../core/services/data.service';
import { ExportService } from '../../core/services/export.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-lost-equipment-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './lost-equipment-admin.component.html',
  styleUrl: './lost-equipment-admin.component.scss'
})
export class LostEquipmentAdminComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly exportSvc = inject(ExportService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);

  protected readonly rows = signal<LostEquipmentDto[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly deletingId = signal<number | null>(null);
  protected readonly statusUpdatingId = signal<number | null>(null);
  protected readonly exportInProgress = signal(false);

  protected readonly statusLabels = LOST_EQUIPMENT_STATUS_LABELS;
  protected readonly statusEnum = LostEquipmentStatus;

  protected readonly addForm = this.fb.group({
    customerName: ['', [Validators.required, Validators.maxLength(200)]],
    itemDescription: ['', [Validators.required, Validators.maxLength(500)]],
    hebrewDate: ['', [Validators.required, Validators.maxLength(100)]],
    notes: ['', Validators.maxLength(2000)]
  });

  ngOnInit(): void {
    this.refresh();
  }

  protected refresh(): void {
    this.loading.set(true);
    this.data
      .getLostEquipment()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (list) => this.rows.set(list)
      });
  }

  protected submitAdd(): void {
    if (this.addForm.invalid) {
      this.addForm.markAllAsTouched();
      this.toast.error('אנא מלאו את השדות הנדרשים');
      return;
    }

    const v = this.addForm.getRawValue();
    this.saving.set(true);
    this.data
      .createLostEquipment({
        customerName: (v.customerName ?? '').trim(),
        itemDescription: (v.itemDescription ?? '').trim(),
        hebrewDate: (v.hebrewDate ?? '').trim(),
        notes: ((v.notes as string) ?? '').trim() || null
      })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (created) => {
          if (created === null) {
            return;
          }
          this.toast.success('הפריט נוסף לרשימת הציוד שנשכח');
          this.addForm.reset({
            customerName: '',
            itemDescription: '',
            hebrewDate: '',
            notes: ''
          });
          this.refresh();
        }
      });
  }

  protected setStatus(row: LostEquipmentDto, status: LostEquipmentStatus): void {
    if (row.status === status) {
      return;
    }

    this.statusUpdatingId.set(row.id);
    this.data
      .updateLostEquipment(row.id, {
        customerName: row.customerName,
        itemDescription: row.itemDescription,
        hebrewDate: row.hebrewDate,
        notes: row.notes,
        status
      })
      .pipe(finalize(() => this.statusUpdatingId.set(null)))
      .subscribe({
        next: (updated) => {
          if (updated === null) {
            return;
          }
          this.rows.update((list) => list.map((r) => (r.id === updated.id ? updated : r)));
          this.toast.success('הסטטוס עודכן');
        }
      });
  }

  protected deleteRow(row: LostEquipmentDto): void {
    const label = row.itemDescription.trim() || row.customerName;
    if (!confirm(`להסיר את "${label}" מהרשימה?`)) {
      return;
    }

    this.deletingId.set(row.id);
    this.data
      .deleteLostEquipment(row.id)
      .pipe(finalize(() => this.deletingId.set(null)))
      .subscribe({
        next: (ok) => {
          if (!ok) {
            return;
          }
          this.rows.update((list) => list.filter((r) => r.id !== row.id));
          this.toast.success('הרשומה נמחקה');
        }
      });
  }

  protected exportToExcel(): void {
    const rows = this.rows();
    if (rows.length === 0) {
      this.toast.show('אין רשומות לייצוא', 'info');
      return;
    }
    if (this.exportInProgress()) {
      return;
    }

    this.exportInProgress.set(true);
    const excelRows = rows.map((row) => ({
      'שם לקוח': row.customerName,
      'תיאור פריט': row.itemDescription,
      'תאריך עברי': row.hebrewDate,
      הערות: row.notes ?? '',
      סטטוס: this.statusLabels[row.status] ?? row.status
    }));
    const stamp = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' });

    void this.exportSvc
      .exportToExcel(excelRows, `lost_equipment_${stamp}`, {
        rtl: true,
        sheetName: 'ציוד שנשכח'
      })
      .then(() => this.toast.success('קובץ Excel הורד'))
      .finally(() => this.exportInProgress.set(false));
  }

  protected statusRowClass(status: LostEquipmentStatus): string {
    switch (status) {
      case LostEquipmentStatus.Returned:
        return 'row-status-returned';
      case LostEquipmentStatus.Notified:
        return 'row-status-notified';
      default:
        return 'row-status-pending';
    }
  }

  protected statusBadgeClass(status: LostEquipmentStatus): string {
    switch (status) {
      case LostEquipmentStatus.Returned:
        return 'status-badge status-badge--returned';
      case LostEquipmentStatus.Notified:
        return 'status-badge status-badge--notified';
      default:
        return 'status-badge status-badge--pending';
    }
  }
}
