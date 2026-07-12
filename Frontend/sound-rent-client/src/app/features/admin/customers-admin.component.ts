import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, finalize } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';

import { CustomerDto, CustomerUpsertDto } from '../../core/models/customer.model';
import { InstitutionCreateUpdateDto, InstitutionDto } from '../../core/models/institution.model';
import { OrderDto } from '../../core/models/order.model';
import { TIME_SLOT_LABELS, TimeSlot } from '../../core/models/enums';
import { CustomersStore } from '../../core/services/customers.store';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';
import {
  israeliPhoneValidator,
  ISRAELI_PHONE_INVALID_MESSAGE,
  optionalIsraeliPhoneValidator
} from '../../core/validators/israeli-phone.validator';

type AdminListMode = 'customers' | 'institutions';

@Component({
  selector: 'app-customers-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './customers-admin.component.html',
  styleUrl: './customers-admin.component.scss'
})
export class CustomersAdminComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly customers = inject(CustomersStore);
  private readonly hebrew = inject(HebrewDateService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  protected readonly listMode = signal<AdminListMode>('customers');
  protected readonly rows = signal<CustomerDto[]>([]);
  protected readonly institutionRows = signal<InstitutionDto[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly deletingPhone = signal<string | null>(null);
  protected readonly deletingInstitutionId = signal<number | null>(null);
  protected readonly exportInProgress = signal(false);
  protected readonly editOpen = signal(false);
  protected readonly isNewCustomer = signal(false);
  protected readonly editOriginalPhone1 = signal('');
  protected readonly phone1ServerError = signal<string | null>(null);
  protected readonly institutionEditOpen = signal(false);
  protected readonly isNewInstitution = signal(false);
  protected readonly editingInstitutionId = signal<number | null>(null);
  protected readonly historyOpen = signal(false);
  protected readonly historyLoading = signal(false);
  protected readonly historyOrders = signal<OrderDto[]>([]);
  protected readonly historyPhone = signal('');
  protected readonly historyInstitutionName = signal('');
  protected readonly historyKind = signal<'customer' | 'institution'>('customer');

  protected readonly searchInput = this.fb.nonNullable.control('');

  protected readonly editForm = this.fb.group({
    phone1: ['', [Validators.required, Validators.maxLength(20), israeliPhoneValidator()]],
    phone2: ['', [Validators.maxLength(20), optionalIsraeliPhoneValidator()]],
    fullName: ['', Validators.maxLength(200)],
    address: ['', Validators.maxLength(500)],
    notes: ['', Validators.maxLength(4000)]
  });

  protected readonly institutionForm = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(200)]],
    defaultNote: ['', Validators.maxLength(2000)]
  });

  protected readonly timeSlotLabels = TIME_SLOT_LABELS;
  protected readonly israeliPhoneInvalidMessage = ISRAELI_PHONE_INVALID_MESSAGE;

  private static readonly PHONE1_CHANGE_CONFIRM =
    'האם אתם בטוחים שברצונכם לשנות את מספר הטלפון הראשי? פעולה זו תעדכן את מספר הטלפון בכל ההזמנות המשויכות ללקוח זה. לחצו על אישור להמשך.';

  ngOnInit(): void {
    this.runSearch('');

    this.searchInput.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((q) => this.runSearch(q));
  }

  protected setListMode(mode: AdminListMode): void {
    if (this.listMode() === mode) {
      return;
    }
    this.listMode.set(mode);
    this.searchInput.setValue('', { emitEvent: false });
    this.runSearch('');
  }

  protected runSearch(q: string): void {
    this.loading.set(true);
    if (this.listMode() === 'institutions') {
      this.data
        .searchInstitutions(q.trim())
        .pipe(finalize(() => this.loading.set(false)))
        .subscribe({
          next: (list) => this.institutionRows.set(list)
        });
      return;
    }

    this.customers
      .search(q.trim())
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (list) => {
          this.rows.set(list);
        }
      });
  }

  protected openAdd(): void {
    this.isNewCustomer.set(true);
    this.editOriginalPhone1.set('');
    this.phone1ServerError.set(null);
    this.editForm.reset({
      phone1: '',
      phone2: '',
      fullName: '',
      address: '',
      notes: ''
    });
    this.editForm.controls.phone1.enable();
    this.editOpen.set(true);
  }

  protected openEdit(c: CustomerDto): void {
    this.isNewCustomer.set(false);
    this.editOriginalPhone1.set(c.phone1);
    this.phone1ServerError.set(null);
    this.editForm.patchValue({
      phone1: c.phone1,
      phone2: c.phone2 ?? '',
      fullName: c.fullName ?? '',
      address: c.address ?? '',
      notes: c.notes ?? ''
    });
    this.editForm.controls.phone1.enable();
    this.editOpen.set(true);
  }

  protected closeEdit(): void {
    this.editOpen.set(false);
    this.phone1ServerError.set(null);
  }

  protected saveEdit(): void {
    this.phone1ServerError.set(null);
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      this.toast.error('אנא תקנו את השדות המסומנים');
      return;
    }

    const raw = this.editForm.getRawValue();
    const phone1 = String(raw.phone1 ?? '').replace(/\D/g, '');
    const phone2Raw = String(raw.phone2 ?? '').replace(/\D/g, '');
    const payload: CustomerUpsertDto = {
      phone1,
      phone2: phone2Raw.length > 0 ? phone2Raw : null,
      fullName: (raw.fullName ?? '').trim() || null,
      address: (raw.address ?? '').trim() || null,
      notes: (raw.notes ?? '').trim() || null
    };

    if (this.isNewCustomer()) {
      this.persistNewCustomer(payload);
      return;
    }

    const originalPhone1 = this.editOriginalPhone1();
    const phoneChanged = phone1 !== originalPhone1;
    if (phoneChanged && !confirm(CustomersAdminComponent.PHONE1_CHANGE_CONFIRM)) {
      return;
    }

    this.saving.set(true);
    this.data
      .updateCustomer(originalPhone1, payload)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (saved) => {
          if (phoneChanged) {
            this.customers.replacePhone1(originalPhone1, saved);
          } else {
            this.customers.upsert(saved);
          }
          this.toast.success(phoneChanged ? 'פרטי הלקוח ומספר הטלפון עודכנו' : 'הלקוח נשמר');
          this.closeEdit();
          this.runSearch(this.searchInput.value.trim());
        },
        error: (err: HttpErrorResponse) => {
          const message = this.extractPhone1ServerError(err);
          if (message) {
            this.phone1ServerError.set(message);
            this.editForm.controls.phone1.markAsTouched();
            return;
          }
          this.toast.error(this.apiErrorMessage(err));
        }
      });
  }

  private persistNewCustomer(payload: CustomerUpsertDto): void {
    this.saving.set(true);
    this.data
      .upsertCustomer(payload)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (saved) => {
          if (saved === null) {
            return;
          }
          this.customers.upsert(saved);
          this.toast.success('הלקוח נשמר');
          this.closeEdit();
          this.runSearch(this.searchInput.value.trim());
        }
      });
  }

  private extractPhone1ServerError(err: HttpErrorResponse): string | null {
    const body = err.error;
    if (!body || typeof body !== 'object' || !('message' in body)) {
      return null;
    }
    const message = String((body as { message?: unknown }).message ?? '').trim();
    return message.length > 0 ? message : null;
  }

  private apiErrorMessage(err: HttpErrorResponse): string {
    return this.extractPhone1ServerError(err) ?? 'אירעה שגיאה בשמירת הלקוח';
  }

  protected openHistory(phone1: string): void {
    this.historyKind.set('customer');
    this.historyPhone.set(phone1);
    this.historyInstitutionName.set('');
    this.historyOrders.set([]);
    this.historyOpen.set(true);
    this.historyLoading.set(true);
    this.data
      .getCustomerOrders(phone1)
      .pipe(finalize(() => this.historyLoading.set(false)))
      .subscribe({
        next: (orders) => {
          this.historyOrders.set(orders);
        }
      });
  }

  protected openInstitutionHistory(row: InstitutionDto): void {
    this.historyKind.set('institution');
    this.historyPhone.set('');
    this.historyInstitutionName.set(row.name);
    this.historyOrders.set([]);
    this.historyOpen.set(true);
    this.historyLoading.set(true);
    this.data
      .getInstitutionOrders(row.id)
      .pipe(finalize(() => this.historyLoading.set(false)))
      .subscribe({
        next: (orders) => this.historyOrders.set(orders)
      });
  }

  protected closeHistory(): void {
    this.historyOpen.set(false);
  }

  /** Opens a new order form pre-filled from a past booking; date is set to today on the form. */
  protected renewOrder(order: OrderDto): void {
    this.closeHistory();
    void this.router.navigate(['/orders/new'], {
      queryParams: { renewFrom: order.id }
    });
  }

  protected deleteCustomer(row: CustomerDto): void {
    const label = row.fullName?.trim() || row.phone1;
    if (!confirm(`האם אתה בטוח שברצונך למחוק את הלקוח ${label}?`)) {
      return;
    }

    this.deletingPhone.set(row.phone1);
    this.data
      .deleteCustomer(row.phone1)
      .pipe(finalize(() => this.deletingPhone.set(null)))
      .subscribe({
        next: (ok) => {
          if (!ok) {
            return;
          }
          this.customers.remove(row.phone1);
          this.toast.success('הלקוח נמחק');
          this.runSearch(this.searchInput.value.trim());
        }
      });
  }

  protected openAddInstitution(): void {
    this.isNewInstitution.set(true);
    this.editingInstitutionId.set(null);
    this.institutionForm.reset({ name: '', defaultNote: '' });
    this.institutionEditOpen.set(true);
  }

  protected openEditInstitution(row: InstitutionDto): void {
    this.isNewInstitution.set(false);
    this.editingInstitutionId.set(row.id);
    this.institutionForm.reset({
      name: row.name,
      defaultNote: row.defaultNote ?? ''
    });
    this.institutionEditOpen.set(true);
  }

  protected closeInstitutionEdit(): void {
    this.institutionEditOpen.set(false);
  }

  protected saveInstitutionEdit(): void {
    if (this.institutionForm.invalid) {
      this.institutionForm.markAllAsTouched();
      this.toast.error('אנא תקנו את השדות המסומנים');
      return;
    }

    const raw = this.institutionForm.getRawValue();
    const payload: InstitutionCreateUpdateDto = {
      name: String(raw.name ?? '').trim(),
      defaultNote: String(raw.defaultNote ?? '').trim() || null
    };

    this.saving.set(true);
    const request$ = this.isNewInstitution()
      ? this.data.createInstitution(payload)
      : this.data.updateInstitution(this.editingInstitutionId()!, payload);

    request$.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: (saved) => {
        if (!saved) {
          return;
        }
        this.toast.success(this.isNewInstitution() ? 'המוסד נוסף' : 'המוסד נשמר');
        this.closeInstitutionEdit();
        this.runSearch(this.searchInput.value.trim());
      }
    });
  }

  protected deleteInstitution(row: InstitutionDto): void {
    if (!confirm(`האם אתה בטוח שברצונך למחוק את המוסד ${row.name}?`)) {
      return;
    }

    this.deletingInstitutionId.set(row.id);
    this.data
      .deleteInstitution(row.id)
      .pipe(finalize(() => this.deletingInstitutionId.set(null)))
      .subscribe({
        next: (ok) => {
          if (!ok) {
            return;
          }
          this.toast.success('המוסד נמחק');
          this.runSearch(this.searchInput.value.trim());
        }
      });
  }

  protected exportToCustomersExcel(): void {
    if (this.exportInProgress()) {
      return;
    }

    this.exportInProgress.set(true);
    this.data
      .exportCustomersExcel()
      .pipe(finalize(() => this.exportInProgress.set(false)))
      .subscribe({
        next: (response) => {
          const blob = response?.body;
          if (!blob) {
            return;
          }

          const fileName =
            this.fileNameFromContentDisposition(response.headers.get('content-disposition')) ??
            `customers_backup_${this.todayFileStamp()}.xlsx`;

          this.downloadBlob(blob, fileName);
          this.toast.success('קובץ Excel של הלקוחות הורד');
        }
      });
  }

  protected exportToInstitutionsExcel(): void {
    if (this.exportInProgress()) {
      return;
    }

    this.exportInProgress.set(true);
    this.data
      .exportInstitutionsExcel()
      .pipe(finalize(() => this.exportInProgress.set(false)))
      .subscribe({
        next: (response) => {
          const blob = response?.body;
          if (!blob) {
            return;
          }

          const fileName =
            this.fileNameFromContentDisposition(response.headers.get('content-disposition')) ??
            `institutions_backup_${this.todayFileStamp()}.xlsx`;

          this.downloadBlob(blob, fileName);
          this.toast.success('קובץ Excel של המוסדות הורד');
        }
      });
  }

  private downloadBlob(blob: Blob, fileName: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  protected slotLabel(slot: TimeSlot): string {
    return this.timeSlotLabels[slot] ?? String(slot);
  }

  protected orderPrimaryDate(order: OrderDto): string {
    return order.shifts[0]?.orderDate ?? '—';
  }

  protected orderHebrewDate(order: OrderDto): string {
    const iso = order.shifts[0]?.orderDate;
    if (!iso) {
      return '—';
    }
    const date = this.hebrew.parseIso(iso);
    return date ? this.hebrew.toHebrew(date) : iso;
  }

  protected orderCreatedTime(order: OrderDto): string {
    const raw = order.createdAt?.trim();
    if (!raw) {
      return '—';
    }
    const created = new Date(raw);
    if (Number.isNaN(created.getTime())) {
      return raw;
    }
    return created.toLocaleString('he-IL', {
      timeZone: 'Asia/Jerusalem',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  }

  protected orderShiftLabels(order: OrderDto): string {
    return order.shifts.map((s) => this.slotLabel(s.timeSlot)).join(', ');
  }

  protected orderEquipmentIds(order: OrderDto): string {
    return order.equipmentDefinitionIds.join(', ');
  }

  private fileNameFromContentDisposition(header: string | null): string | null {
    if (!header) {
      return null;
    }

    const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
    if (utf8Match?.[1]) {
      return decodeURIComponent(utf8Match[1]);
    }

    const asciiMatch = /filename="?([^";]+)"?/i.exec(header);
    return asciiMatch?.[1] ?? null;
  }

  private todayFileStamp(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }
}
