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
  OpenDebtGroupDto
} from '../../core/models/open-debt.model';
import { CustomersStore } from '../../core/services/customers.store';
import { DataService } from '../../core/services/data.service';
import { ExportService } from '../../core/services/export.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import {
  ISRAELI_PHONE_INVALID_MESSAGE,
  israeliPhoneValidator
} from '../../core/validators/israeli-phone.validator';
import { IsraeliPhoneInputDirective } from '../../shared/directives/israeli-phone-input.directive';
import { ClickOutsideDirective } from '../../shared/directives/click-outside.directive';

@Component({
  selector: 'app-tools-reports',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, IsraeliPhoneInputDirective, ClickOutsideDirective],
  templateUrl: './tools-reports.component.html',
  styleUrl: './tools-reports.component.scss'
})
export class ToolsReportsComponent implements OnInit {
  private readonly data = inject(DataService);
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
  protected readonly savingDebt = signal(false);
  protected readonly israeliPhoneInvalidMessage = ISRAELI_PHONE_INVALID_MESSAGE;
  protected readonly customerSuggestions = signal<CustomerSuggestDto[]>([]);
  protected readonly customerSuggestOpen = signal(false);
  protected readonly customerSuggestField = signal<'name' | 'phone' | null>(null);
  protected readonly customerSuggestIndex = signal(-1);

  /** Always filter to Tools category only */
  protected readonly filteredOpenDebts = computed(() =>
    this.openDebtGroups()
      .filter((r) => (r.totalAmount ?? 0) > 0)
      .filter((r) => r.categoryLabel === 'כלי עבודה')
  );

  protected readonly debtForm = this.fb.group({
    customerName: ['', [Validators.maxLength(200)]],
    phone: ['', [Validators.required, Validators.maxLength(20), israeliPhoneValidator()]],
    address: ['', [Validators.maxLength(300)]],
    itemDescription: ['', [Validators.maxLength(300)]],
    deposit: ['', [Validators.maxLength(500)]],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]]
  });

  ngOnInit(): void {
    this.wireCustomerAutocomplete();
    this.loadUnpaid();
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

  protected openAddDebt(): void {
    this.debtForm.reset({
      customerName: '',
      phone: '',
      address: '',
      itemDescription: '',
      deposit: '',
      amount: null
    });
    this.closeCustomerSuggestions();
    this.addDebtOpen.set(true);
  }

  protected closeAddDebt(): void {
    this.addDebtOpen.set(false);
    this.closeCustomerSuggestions();
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

    const v = this.debtForm.getRawValue();
    const payload: CreateOpenDebtDto = {
      customerName: (v.customerName ?? '').trim() || null,
      phone: (v.phone ?? '').trim(),
      address: (v.address ?? '').trim() || null,
      category: 'Tools' as DebtCategory,
      itemDescription: (v.itemDescription ?? '').trim() || null,
      deposit: (v.deposit ?? '').trim() || null,
      amount: Number(v.amount)
    };

    this.savingDebt.set(true);
    this.data
      .createOpenDebt(payload)
      .pipe(finalize(() => this.savingDebt.set(false)))
      .subscribe({
        next: (created) => {
          if (!created) {
            return;
          }
          this.openDebtGroups.update((list) => {
            const without = list.filter((g) => g.groupKey !== created.group.groupKey);
            return [created.group, ...without];
          });
          this.closeAddDebt();
          this.toast.success('החוב נוסף בהצלחה');
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
          'שם לקוח': g.customerName ?? '',
          טלפון: g.phone,
          קטגוריה: g.categoryLabel,
          ציוד: g.equipmentSummary,
          פיקדון: g.deposit ?? '',
          'תאריך חיוב': this.sessionHebrewDate(g),
          'סכום כולל': g.totalAmount
        })),
        `tools_debts_${this.todayFileStamp()}.xlsx`
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
