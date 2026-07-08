import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { debounceTime, EMPTY, finalize, map, merge, switchMap } from 'rxjs';

import { CustomerDto } from '../../core/models/customer.model';
import {
  LOST_EQUIPMENT_STATUS_LABELS,
  LostEquipmentDto,
  LostEquipmentStatus
} from '../../core/models/lost-equipment.model';
import { CustomersStore } from '../../core/services/customers.store';
import { DataService } from '../../core/services/data.service';
import { ExportService } from '../../core/services/export.service';
import { HebrewDateParts, HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';
import { IntegerOnlyDirective } from '../../shared/directives/integer-only.directive';
import { HebrewCalendarPickerComponent } from '../../shared/hebrew-calendar-picker/hebrew-calendar-picker.component';
import {
  ISRAELI_PHONE_INVALID_MESSAGE,
  optionalIsraeliPhoneValidator
} from '../../core/validators/israeli-phone.validator';

@Component({
  selector: 'app-lost-equipment-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, IntegerOnlyDirective, HebrewCalendarPickerComponent],
  templateUrl: './lost-equipment-admin.component.html',
  styleUrl: './lost-equipment-admin.component.scss'
})
export class LostEquipmentAdminComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly exportSvc = inject(ExportService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly customers = inject(CustomersStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly hebrew = inject(HebrewDateService);

  private readonly initialHebrew = this.hebrew.toHebrewParts(new Date());

  protected readonly hebrewYearSig = signal(this.initialHebrew.year);
  protected readonly hebrewMonthSig = signal(this.initialHebrew.month);
  protected readonly hebrewDaySig = signal(this.initialHebrew.day);

  protected readonly rows = signal<LostEquipmentDto[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly deletingId = signal<number | null>(null);
  protected readonly statusUpdatingId = signal<number | null>(null);
  protected readonly exportInProgress = signal(false);

  protected readonly customerSuggestions = signal<CustomerDto[]>([]);
  protected readonly customerSuggestOpen = signal(false);
  protected readonly customerSuggestField = signal<'name' | 'phone' | null>(null);
  protected readonly customerSuggestIndex = signal(-1);

  protected readonly statusLabels = LOST_EQUIPMENT_STATUS_LABELS;
  protected readonly statusEnum = LostEquipmentStatus;
  protected readonly israeliPhoneInvalidMessage = ISRAELI_PHONE_INVALID_MESSAGE;

  private static readonly CUSTOMER_SUGGEST_LIMIT = 8;

  protected readonly addForm = this.fb.group({
    customerName: ['', [Validators.required, Validators.maxLength(200)]],
    phone: ['', [Validators.maxLength(20), optionalIsraeliPhoneValidator()]],
    itemDescription: ['', [Validators.required, Validators.maxLength(500)]],
    hebrewDate: ['', [Validators.required, Validators.maxLength(100)]],
    notes: ['', Validators.maxLength(2000)]
  });

  ngOnInit(): void {
    this.wireCustomerAutocomplete();
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

  protected customerSuggestLabel(c: CustomerDto): string {
    const name = (c.fullName ?? '').trim() || 'ללא שם';
    return `${name} - ${c.phone1}`;
  }

  protected patchHebrewFromCalendar(
    part: Partial<Pick<HebrewDateParts, 'year' | 'month' | 'day'>>
  ): void {
    const year = part.year ?? this.hebrewYearSig();
    const month = part.month ?? this.hebrewMonthSig();
    const day = part.day ?? this.hebrewDaySig();

    this.hebrewYearSig.set(year);
    this.hebrewMonthSig.set(month);
    this.hebrewDaySig.set(day);
    this.addForm.patchValue({
      hebrewDate: this.hebrew.formatHebrewDate(day, month, year)
    });
    this.addForm.controls.hebrewDate.markAsTouched();
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

  protected selectCustomerSuggestion(c: CustomerDto, event?: Event): void {
    event?.preventDefault();
    this.addForm.patchValue(
      {
        customerName: c.fullName ?? '',
        phone: c.phone1 ?? ''
      },
      { emitEvent: false }
    );
    this.closeCustomerSuggestions();
    this.toast.show('פרטי הלקוח מולאו מהרשימה', 'info');
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
        phone: ((v.phone as string) ?? '').trim() || null,
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
            phone: '',
            itemDescription: '',
            hebrewDate: '',
            notes: ''
          });
          this.resetHebrewDatePicker();
          this.closeCustomerSuggestions();
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
        phone: row.phone,
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
      'מספר טלפון': row.phone ?? '',
      'תיאור פריט': row.itemDescription,
      תאריך: row.hebrewDate,
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
          if (q.length < 1) {
            this.closeCustomerSuggestions();
            return EMPTY;
          }
          return this.customers.search(q).pipe(
            map((list) => ({
              field,
              q,
              list: list.slice(0, LostEquipmentAdminComponent.CUSTOMER_SUGGEST_LIMIT)
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

  private closeCustomerSuggestions(): void {
    this.customerSuggestOpen.set(false);
    this.customerSuggestIndex.set(-1);
    this.customerSuggestions.set([]);
    this.customerSuggestField.set(null);
  }

  private resetHebrewDatePicker(): void {
    const today = this.hebrew.toHebrewParts(new Date());
    this.hebrewYearSig.set(today.year);
    this.hebrewMonthSig.set(today.month);
    this.hebrewDaySig.set(today.day);
  }
}
