import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, finalize } from 'rxjs';

import { CustomerDto, CustomerUpsertDto } from '../../core/models/customer.model';
import { OrderDto } from '../../core/models/order.model';
import { TIME_SLOT_LABELS, TimeSlot } from '../../core/models/enums';
import { DataService } from '../../core/services/data.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-customers-admin',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './customers-admin.component.html',
  styleUrl: './customers-admin.component.scss'
})
export class CustomersAdminComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly rows = signal<CustomerDto[]>([]);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly editOpen = signal(false);
  protected readonly isNewCustomer = signal(false);
  protected readonly historyOpen = signal(false);
  protected readonly historyLoading = signal(false);
  protected readonly historyOrders = signal<OrderDto[]>([]);
  protected readonly historyPhone = signal('');

  protected readonly searchInput = this.fb.nonNullable.control('');

  protected readonly editForm = this.fb.group({
    phone1: ['', [Validators.required, Validators.maxLength(20), Validators.pattern(/^\d{9,10}$/)]],
    phone2: ['', [Validators.maxLength(20), Validators.pattern(/^$|^\d{9,10}$/)]],
    fullName: ['', Validators.maxLength(200)],
    address: ['', Validators.maxLength(500)],
    notes: ['', Validators.maxLength(4000)]
  });

  protected readonly timeSlotLabels = TIME_SLOT_LABELS;

  ngOnInit(): void {
    this.runSearch('');

    this.searchInput.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((q) => this.runSearch(q));
  }

  protected runSearch(q: string): void {
    this.loading.set(true);
    this.data
      .searchCustomers(q.trim())
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (list) => {
          this.rows.set(list);
        }
      });
  }

  protected openAdd(): void {
    this.isNewCustomer.set(true);
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
    this.editForm.patchValue({
      phone1: c.phone1,
      phone2: c.phone2 ?? '',
      fullName: c.fullName ?? '',
      address: c.address ?? '',
      notes: c.notes ?? ''
    });
    this.editForm.controls.phone1.disable();
    this.editOpen.set(true);
  }

  protected closeEdit(): void {
    this.editOpen.set(false);
  }

  protected saveEdit(): void {
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

    this.saving.set(true);
    this.data
      .upsertCustomer(payload)
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (saved) => {
          if (saved === null) {
            return;
          }
          this.toast.success('הלקוח נשמר');
          this.closeEdit();
          this.runSearch(this.searchInput.value.trim());
        }
      });
  }

  protected openHistory(phone1: string): void {
    this.historyPhone.set(phone1);
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

  protected closeHistory(): void {
    this.historyOpen.set(false);
  }

  protected slotLabel(slot: TimeSlot): string {
    return this.timeSlotLabels[slot] ?? String(slot);
  }
}
