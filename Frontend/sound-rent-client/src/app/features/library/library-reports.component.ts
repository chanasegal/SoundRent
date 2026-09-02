import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FormsModule } from '@angular/forms';
import { debounceTime, EMPTY, finalize, map, merge, switchMap } from 'rxjs';

import { CustomerSuggestDto } from '../../core/models/customer.model';
import {
  CreateOpenDebtDto,
  DebtCategory,
  OpenDebtGroupDto,
  UpdateOpenDebtDto
} from '../../core/models/open-debt.model';
import { CustomersStore } from '../../core/services/customers.store';
import { DataService } from '../../core/services/data.service';
import { ExportService } from '../../core/services/export.service';
import { HebrewDateParts, HebrewDateService } from '../../core/services/hebrew-date.service';
import { OrdersSyncService } from '../../core/services/orders-sync.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import { startLiveDataRefresh } from '../../core/utils/live-data-refresh';
import {
  ISRAELI_PHONE_INVALID_MESSAGE,
  israeliPhoneValidator
} from '../../core/validators/israeli-phone.validator';
import { IsraeliPhoneInputDirective } from '../../shared/directives/israeli-phone-input.directive';
import { ClickOutsideDirective } from '../../shared/directives/click-outside.directive';
import { HebrewCalendarPickerComponent } from '../../shared/hebrew-calendar-picker/hebrew-calendar-picker.component';

@Component({
  selector: 'app-library-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    IsraeliPhoneInputDirective,
    ClickOutsideDirective,
    HebrewCalendarPickerComponent
  ],
  templateUrl: './library-reports.component.html',
  styleUrl: './library-reports.component.scss'
})
export class LibraryReportsComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly ordersSync = inject(OrdersSyncService);
  private readonly exportSvc = inject(ExportService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly toast = inject(ToastService);
  private readonly customers = inject(CustomersStore);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly pageTitle = inject(WorkspaceUiService).title('דוחות חובות');

  protected readonly openDebtGroups = signal<OpenDebtGroupDto[]>([]);
  protected readonly loadingUnpaid = signal(false);
  protected readonly exportUnpaidInProgress = signal(false);
  protected readonly markingPaidKey = signal<string | null>(null);

  protected readonly addDebtOpen = signal(false);
  protected readonly editingDebtId = signal<number | null>(null);
  protected readonly editingOrderId = signal<number | null>(null);
  protected readonly savingDebt = signal(false);
  protected readonly deletingDebtKey = signal<string | null>(null);
  protected readonly israeliPhoneInvalidMessage = ISRAELI_PHONE_INVALID_MESSAGE;
  protected readonly customerSuggestions = signal<CustomerSuggestDto[]>([]);
  protected readonly customerSuggestOpen = signal(false);
  protected readonly customerSuggestField = signal<'name' | 'phone' | null>(null);
  protected readonly customerSuggestIndex = signal(-1);

  private readonly initialHebrew = this.hebrew.toHebrewParts(new Date());
  protected readonly debtHebrewYearSig = signal(this.initialHebrew.year);
  protected readonly debtHebrewMonthSig = signal(this.initialHebrew.month);
  protected readonly debtHebrewDaySig = signal(this.initialHebrew.day);

  /** Always filter to Library category only */
  protected readonly filteredOpenDebts = computed(() =>
    this.openDebtGroups()
      .filter((r) => (r.totalAmount ?? 0) > 0)
      .filter((r) => r.categoryLabel === 'ספריה')
  );

  protected readonly debtModalTitle = computed(() =>
    this.editingDebtId() != null ? 'עריכת חוב – ספריה' : 'הוסף חוב חדש – ספריה'
  );

  protected readonly debtForm = this.fb.group({
    customerName: ['', [Validators.maxLength(200)]],
    phone: ['', [Validators.required, Validators.maxLength(20), israeliPhoneValidator()]],
    address: ['', [Validators.maxLength(300)]],
    itemDescription: ['', [Validators.maxLength(300)]],
    deposit: ['', [Validators.maxLength(500)]],
    notes: ['', [Validators.maxLength(2000)]],
    hebrewDate: ['', [Validators.required, Validators.maxLength(100)]],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]]
  });

  ngOnInit(): void {
    this.wireCustomerAutocomplete();
    this.loadUnpaid();

    this.ordersSync.debtChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadUnpaid());

    startLiveDataRefresh(
      this.destroyRef,
      () => this.loadUnpaid(),
      {
        skipWhen: () =>
          this.loadingUnpaid() ||
          this.savingDebt() ||
          this.markingPaidKey() != null ||
          this.deletingDebtKey() != null ||
          this.addDebtOpen()
      }
    );
  }

  protected loadUnpaid(): void {
    this.loadingUnpaid.set(true);
    this.data
      .getOpenDebtGroupsReport()
      .pipe(finalize(() => this.loadingUnpaid.set(false)))
      .subscribe({
        next: (groups) => this.openDebtGroups.set(groups)
      });
  }

  protected canEditDebtGroup(group: OpenDebtGroupDto): boolean {
    return (group.debtIds?.length ?? 0) > 0 || (group.orderIds?.length ?? 0) > 0;
  }

  protected openAddDebt(): void {
    const parts = this.hebrew.toHebrewParts(new Date());
    this.editingDebtId.set(null);
    this.editingOrderId.set(null);
    this.setDebtHebrewParts(parts);
    this.debtForm.reset({
      customerName: '',
      phone: '',
      address: '',
      itemDescription: '',
      deposit: '',
      notes: '',
      hebrewDate: this.hebrew.formatHebrewDate(parts.day, parts.month, parts.year),
      amount: null
    });
    this.closeCustomerSuggestions();
    this.addDebtOpen.set(true);
  }

  protected openEditDebt(group: OpenDebtGroupDto): void {
    const debtId = group.debtIds?.[0];
    if (debtId != null) {
      this.savingDebt.set(true);
      this.data
        .getOpenDebt(debtId)
        .pipe(finalize(() => this.savingDebt.set(false)))
        .subscribe({
          next: (debt) => {
            if (!debt) {
              return;
            }
            const charged = new Date(debt.chargedAt);
            const parts = Number.isNaN(charged.getTime())
              ? this.hebrew.toHebrewParts(new Date())
              : this.hebrew.toHebrewParts(charged);
            this.editingDebtId.set(debt.id);
            this.editingOrderId.set(null);
            this.setDebtHebrewParts(parts);
            this.debtForm.reset({
              customerName: debt.customerName ?? '',
              phone: debt.phone ?? '',
              address: debt.address ?? '',
              itemDescription: debt.itemDescription ?? '',
              deposit: debt.deposit ?? '',
              notes: debt.notes ?? '',
              hebrewDate: this.hebrew.formatHebrewDate(parts.day, parts.month, parts.year),
              amount: debt.amount
            });
            this.closeCustomerSuggestions();
            this.addDebtOpen.set(true);
          }
        });
      return;
    }

    const orderId = group.orderIds?.[0];
    if (orderId == null) {
      return;
    }

    const charged = new Date(group.sessionDate);
    const parts = Number.isNaN(charged.getTime())
      ? this.hebrew.toHebrewParts(new Date())
      : this.hebrew.toHebrewParts(charged);
    this.editingDebtId.set(null);
    this.editingOrderId.set(orderId);
    this.setDebtHebrewParts(parts);
    this.debtForm.reset({
      customerName: group.customerName ?? '',
      phone: group.phone ?? '',
      address: group.address ?? '',
      itemDescription: group.equipmentSummary ?? '',
      deposit: group.deposit ?? '',
      notes: group.notes ?? '',
      hebrewDate: this.hebrew.formatHebrewDate(parts.day, parts.month, parts.year),
      amount: group.totalAmount
    });
    this.closeCustomerSuggestions();
    this.addDebtOpen.set(true);
  }

  protected closeAddDebt(): void {
    this.addDebtOpen.set(false);
    this.editingDebtId.set(null);
    this.editingOrderId.set(null);
    this.closeCustomerSuggestions();
  }

  protected patchDebtHebrewFromCalendar(
    part: Partial<Pick<HebrewDateParts, 'year' | 'month' | 'day'>>
  ): void {
    const year = part.year ?? this.debtHebrewYearSig();
    const month = part.month ?? this.debtHebrewMonthSig();
    const day = part.day ?? this.debtHebrewDaySig();
    this.setDebtHebrewParts({ year, month, day });
    this.debtForm.patchValue({
      hebrewDate: this.hebrew.formatHebrewDate(day, month, year)
    });
    this.debtForm.controls.hebrewDate.markAsTouched();
  }

  protected submitAddDebt(): void {
    if (this.debtForm.invalid) {
      this.debtForm.markAllAsTouched();
      this.toast.error('אנא מלאו את השדות הנדרשים');
      return;
    }
    if (this.savingDebt()) {
      return;
    }

    const chargedAt = this.hebrewPartsToIso(
      this.debtHebrewYearSig(),
      this.debtHebrewMonthSig(),
      this.debtHebrewDaySig()
    );
    if (!chargedAt) {
      this.toast.error('תאריך לא תקין');
      return;
    }

    const v = this.debtForm.getRawValue();
    const base = {
      customerName: (v.customerName ?? '').trim() || null,
      phone: (v.phone ?? '').trim(),
      address: (v.address ?? '').trim() || null,
      category: 'Library' as DebtCategory,
      itemDescription: (v.itemDescription ?? '').trim() || null,
      deposit: (v.deposit ?? '').trim() || null,
      notes: (v.notes ?? '').trim() || null,
      amount: Number(v.amount),
      chargedAt
    };

    const editingDebtId = this.editingDebtId();
    const editingOrderId = this.editingOrderId();
    this.savingDebt.set(true);

    const request$ =
      editingDebtId != null
        ? this.data.updateOpenDebt(editingDebtId, base as UpdateOpenDebtDto)
        : editingOrderId != null
          ? this.data.updateOpenDebtOrder(editingOrderId, base as UpdateOpenDebtDto)
          : this.data.createOpenDebt(base as CreateOpenDebtDto);

    request$.pipe(finalize(() => this.savingDebt.set(false))).subscribe({
      next: (created) => {
        if (!created) {
          return;
        }
        this.openDebtGroups.update((list) => {
          const without = list.filter((g) => {
            if (g.groupKey === created.group.groupKey) {
              return false;
            }
            if (editingDebtId != null && (g.debtIds ?? []).includes(editingDebtId)) {
              return false;
            }
            if (editingOrderId != null && (g.orderIds ?? []).includes(editingOrderId)) {
              return false;
            }
            return true;
          });
          return [created.group, ...without];
        });
        this.ordersSync.notifyDebtChanged();
        this.closeAddDebt();
        this.toast.success(
          editingDebtId != null || editingOrderId != null ? 'החוב עודכן בהצלחה' : 'החוב נוסף בהצלחה'
        );
      }
    });
  }

  protected deleteDebtGroup(group: OpenDebtGroupDto): void {
    if (this.deletingDebtKey() !== null) {
      return;
    }
    const label = group.customerName?.trim() || group.phone;
    if (!confirm(`למחוק את החוב של ${label}? לא ניתן לשחזר פעולה זו.`)) {
      return;
    }

    this.deletingDebtKey.set(group.groupKey);
    this.data
      .deleteOpenDebtGroup({
        debtIds: group.debtIds ?? [],
        orderIds: group.orderIds ?? []
      })
      .pipe(finalize(() => this.deletingDebtKey.set(null)))
      .subscribe({
        next: (ok) => {
          if (!ok) {
            return;
          }
          this.openDebtGroups.update((list) => list.filter((g) => g.groupKey !== group.groupKey));
          this.ordersSync.notifyDebtChanged();
          this.toast.success('החוב נמחק בהצלחה');
        }
      });
  }

  protected exportUnpaidToExcel(): void {
    const rows = this.filteredOpenDebts();
    if (rows.length === 0) {
      this.toast.show('אין חובות פתוחים לייצוא', 'info');
      return;
    }
    if (this.exportUnpaidInProgress()) {
      return;
    }
    this.exportUnpaidInProgress.set(true);
    void this.exportSvc
      .exportToExcel(
        rows.map((g) => ({
          'תאריך חיוב': this.sessionHebrewDate(g),
          ספר: g.equipmentSummary,
          'שם לקוח': g.customerName ?? '',
          טלפון: g.phone,
          כתובת: g.address ?? '',
          קטגוריה: g.categoryLabel,
          פיקדון: g.deposit ?? '',
          הערות: g.notes ?? '',
          'סכום כולל': g.totalAmount
        })),
        `library_debts_${this.todayFileStamp()}.xlsx`
      )
      .then(() => this.toast.success('קובץ Excel הורד'))
      .finally(() => this.exportUnpaidInProgress.set(false));
  }

  protected markGroupAsPaid(group: OpenDebtGroupDto): void {
    if (this.markingPaidKey() !== null) {
      return;
    }
    this.markingPaidKey.set(group.groupKey);
    this.data
      .markOpenDebtGroupPaid({
        debtIds: group.debtIds ?? [],
        orderIds: group.orderIds ?? []
      })
      .pipe(finalize(() => this.markingPaidKey.set(null)))
      .subscribe({
        next: (ok) => {
          if (!ok) {
            return;
          }
          this.openDebtGroups.update((list) => list.filter((g) => g.groupKey !== group.groupKey));
          this.ordersSync.notifyDebtChanged();
          this.toast.success('החובות בקבוצה סומנו כשולמו');
        }
      });
  }

  protected sessionHebrewDate(group: OpenDebtGroupDto): string {
    const date = new Date(group.sessionDate);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    return this.hebrew.toHebrew(date);
  }

  protected formatPhone(phone: string | null | undefined): string {
    const raw = (phone ?? '').trim();
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return raw || '—';
  }

  protected formatGroupAmount(group: OpenDebtGroupDto): string {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      maximumFractionDigits: 0
    }).format(group.totalAmount ?? 0);
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
    this.debtForm.patchValue(
      { customerName: c.fullName ?? '', phone: c.phone1 ?? '', address: c.address ?? '' },
      { emitEvent: false }
    );
    this.closeCustomerSuggestions();
  }

  protected closeCustomerSuggestions(): void {
    this.customerSuggestOpen.set(false);
    this.customerSuggestField.set(null);
    this.customerSuggestIndex.set(-1);
  }

  private setDebtHebrewParts(parts: HebrewDateParts): void {
    this.debtHebrewYearSig.set(parts.year);
    this.debtHebrewMonthSig.set(parts.month);
    this.debtHebrewDaySig.set(parts.day);
  }

  private hebrewPartsToIso(year: number, month: number, day: number): string | null {
    try {
      return this.hebrew.toIso(this.hebrew.toGregorian(year, month, day));
    } catch {
      return null;
    }
  }

  private wireCustomerAutocomplete(): void {
    const name$ = this.debtForm.controls.customerName.valueChanges.pipe(
      map((v) => ({ field: 'name' as const, q: (v ?? '').trim() }))
    );
    const phone$ = this.debtForm.controls.phone.valueChanges.pipe(
      map((v) => ({ field: 'phone' as const, q: (v ?? '').trim() }))
    );

    merge(name$, phone$)
      .pipe(
        debounceTime(300),
        switchMap(({ field, q }) => {
          if (q.length < 2) {
            this.customerSuggestions.set([]);
            this.customerSuggestOpen.set(false);
            return EMPTY;
          }
          this.customerSuggestField.set(field);
          return this.customers.searchSuggest(q).pipe(map((list) => list.slice(0, 8)));
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((list) => {
        this.customerSuggestions.set(list);
        this.customerSuggestOpen.set(list.length > 0);
        this.customerSuggestIndex.set(list.length > 0 ? 0 : -1);
      });
  }

  private todayFileStamp(): string {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  }
}
