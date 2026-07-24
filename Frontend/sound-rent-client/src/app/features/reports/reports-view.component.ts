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
import { RouterLink } from '@angular/router';
import { debounceTime, EMPTY, finalize, map, merge, switchMap } from 'rxjs';

import { CustomerSuggestDto } from '../../core/models/customer.model';
import {
  CreateOpenDebtDto,
  DEBT_CATEGORY_OPTIONS,
  DebtCategory,
  OpenDebtGroupDto
} from '../../core/models/open-debt.model';
import { CreateManualCancelledOrderDto, OrderDto } from '../../core/models/order.model';
import { CalendarViewStateService } from '../../core/services/calendar-view-state.service';
import { CustomersStore } from '../../core/services/customers.store';
import { DataService } from '../../core/services/data.service';
import { EquipmentDefinitionsStore } from '../../core/services/equipment-definitions.store';
import { ExportService } from '../../core/services/export.service';
import { HebrewDateParts, HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import {
  ISRAELI_PHONE_INVALID_MESSAGE,
  israeliPhoneValidator
} from '../../core/validators/israeli-phone.validator';
import { IsraeliPhoneInputDirective } from '../../shared/directives/israeli-phone-input.directive';
import { HebrewCalendarPickerComponent } from '../../shared/hebrew-calendar-picker/hebrew-calendar-picker.component';

type ReportsTab = 'cancelled' | 'unpaid';
type DebtCategoryFilter = 'all' | 'כלי עבודה' | 'הגברה' | 'ספריה';

@Component({
  selector: 'app-reports-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, FormsModule, ReactiveFormsModule, IsraeliPhoneInputDirective, HebrewCalendarPickerComponent],
  templateUrl: './reports-view.component.html',
  styleUrl: './reports-view.component.scss'
})
export class ReportsViewComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly exportSvc = inject(ExportService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly equipmentSlots = inject(EquipmentDefinitionsStore);
  private readonly toast = inject(ToastService);
  private readonly calendarView = inject(CalendarViewStateService);
  private readonly customers = inject(CustomersStore);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly pageTitle = inject(WorkspaceUiService).title('דוחות');

  protected readonly boardQueryParams = computed(() => this.calendarView.dashboardQueryParams());
  protected readonly activeTab = signal<ReportsTab>('cancelled');
  protected readonly cancelledOrders = signal<OrderDto[]>([]);
  protected readonly openDebtGroups = signal<OpenDebtGroupDto[]>([]);
  protected readonly debtCategoryFilter = signal<DebtCategoryFilter>('all');
  protected readonly loadingCancelled = signal(false);
  protected readonly loadingUnpaid = signal(false);
  protected readonly exportCancelledInProgress = signal(false);
  protected readonly exportUnpaidInProgress = signal(false);
  protected readonly markingPaidKey = signal<string | null>(null);
  protected readonly deletingOrderId = signal<number | null>(null);

  protected readonly addDebtOpen = signal(false);
  protected readonly savingDebt = signal(false);
  protected readonly debtCategoryOptions = DEBT_CATEGORY_OPTIONS;
  protected readonly israeliPhoneInvalidMessage = ISRAELI_PHONE_INVALID_MESSAGE;
  protected readonly customerSuggestions = signal<CustomerSuggestDto[]>([]);
  protected readonly customerSuggestOpen = signal(false);
  protected readonly customerSuggestField = signal<'name' | 'phone' | null>(null);
  protected readonly customerSuggestIndex = signal(-1);

  protected readonly addCancelledOpen = signal(false);
  protected readonly savingCancelled = signal(false);
  protected readonly cancelledEquipmentDropdownOpen = signal(false);
  protected readonly cancelledCustomerSuggestField = signal<'name' | 'phone' | null>(null);

  private readonly initialHebrew = this.hebrew.toHebrewParts(new Date());

  protected readonly startHebrewYearSig = signal(this.initialHebrew.year);
  protected readonly startHebrewMonthSig = signal(this.initialHebrew.month);
  protected readonly startHebrewDaySig = signal(this.initialHebrew.day);
  protected readonly endHebrewYearSig = signal(this.initialHebrew.year);
  protected readonly endHebrewMonthSig = signal(this.initialHebrew.month);
  protected readonly endHebrewDaySig = signal(this.initialHebrew.day);

  protected readonly startYearOptions = signal(this.buildYearOptions());
  protected readonly endYearOptions = signal(this.buildYearOptions());
  protected readonly startMonthOptions = signal(this.hebrew.monthsForYear(this.initialHebrew.year));
  protected readonly endMonthOptions = signal(this.hebrew.monthsForYear(this.initialHebrew.year));
  protected readonly startDayOptions = signal(this.buildDayOptions(this.initialHebrew.month, this.initialHebrew.year));
  protected readonly endDayOptions = signal(this.buildDayOptions(this.initialHebrew.month, this.initialHebrew.year));

  protected readonly activeEquipmentOptions = computed(() =>
    this.equipmentSlots
      .boardSlotDefinitions()
      .filter((d) => d.isUnderMaintenance !== true)
  );

  protected readonly debtForm = this.fb.group({
    customerName: ['', [Validators.maxLength(200)]],
    phone: ['', [Validators.required, Validators.maxLength(20), israeliPhoneValidator()]],
    address: ['', [Validators.maxLength(300)]],
    category: ['Amplification' as DebtCategory],
    itemDescription: ['', [Validators.maxLength(300)]],
    deposit: ['', [Validators.maxLength(500)]],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]]
  });

  protected readonly cancelledForm = this.fb.group({
    customerName: ['', [Validators.maxLength(100)]],
    phone: ['', [Validators.required, Validators.maxLength(20), israeliPhoneValidator()]],
    address: ['', [Validators.maxLength(200)]],
    equipmentDefinitionIds: [[] as string[], [Validators.required, Validators.minLength(1)]],
    startHebrewYear: [this.initialHebrew.year, Validators.required],
    startHebrewMonth: [this.initialHebrew.month, Validators.required],
    startHebrewDay: [this.initialHebrew.day, Validators.required],
    endHebrewYear: [this.initialHebrew.year, Validators.required],
    endHebrewMonth: [this.initialHebrew.month, Validators.required],
    endHebrewDay: [this.initialHebrew.day, Validators.required],
    totalAmount: [null as number | null, [Validators.min(0)]]
  });

  protected readonly filteredOpenDebts = computed(() => {
    const filter = this.debtCategoryFilter();
    const rows = this.openDebtGroups().filter((r) => (r.totalAmount ?? 0) > 0);
    if (filter === 'all') {
      return rows;
    }
    return rows.filter((r) => r.categoryLabel === filter);
  });

  ngOnInit(): void {
    this.equipmentSlots.load().subscribe();
    this.wireCustomerAutocomplete();
    this.wireCancelledCustomerAutocomplete();
    this.wireCancelledDateForm();
    this.loadCancelled();
    this.loadUnpaid();
  }

  protected switchTab(tab: ReportsTab): void {
    this.activeTab.set(tab);
  }

  protected refreshActiveTab(): void {
    if (this.activeTab() === 'cancelled') {
      this.loadCancelled();
      return;
    }
    this.loadUnpaid();
  }

  protected loadCancelled(): void {
    this.loadingCancelled.set(true);
    this.data
      .getCancelledOrdersReport()
      .pipe(finalize(() => this.loadingCancelled.set(false)))
      .subscribe({
        next: (orders) => this.cancelledOrders.set(orders)
      });
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

  protected onDebtCategoryFilterChange(value: string): void {
    const allowed: DebtCategoryFilter[] = ['all', 'כלי עבודה', 'הגברה', 'ספריה'];
    this.debtCategoryFilter.set(
      allowed.includes(value as DebtCategoryFilter) ? (value as DebtCategoryFilter) : 'all'
    );
  }

  protected openAddDebt(): void {
    this.debtForm.reset({
      customerName: '',
      phone: '',
      address: '',
      category: 'Amplification',
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
      category: (v.category ?? 'Amplification') as DebtCategory,
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

  protected openAddCancelled(): void {
    const parts = this.hebrew.toHebrewParts(new Date());
    this.cancelledForm.reset({
      customerName: '',
      phone: '',
      address: '',
      equipmentDefinitionIds: [],
      startHebrewYear: parts.year,
      startHebrewMonth: parts.month,
      startHebrewDay: parts.day,
      endHebrewYear: parts.year,
      endHebrewMonth: parts.month,
      endHebrewDay: parts.day,
      totalAmount: null
    });
    this.startHebrewYearSig.set(parts.year);
    this.startHebrewMonthSig.set(parts.month);
    this.startHebrewDaySig.set(parts.day);
    this.endHebrewYearSig.set(parts.year);
    this.endHebrewMonthSig.set(parts.month);
    this.endHebrewDaySig.set(parts.day);
    this.syncStartDayOptions();
    this.syncEndDayOptions();
    this.cancelledEquipmentDropdownOpen.set(false);
    this.closeCustomerSuggestions();
    this.addCancelledOpen.set(true);
  }

  protected closeAddCancelled(): void {
    this.addCancelledOpen.set(false);
    this.cancelledEquipmentDropdownOpen.set(false);
    this.closeCustomerSuggestions();
  }

  protected submitAddCancelled(): void {
    if (this.cancelledForm.invalid) {
      this.cancelledForm.markAllAsTouched();
      this.toast.error('אנא מלאו את השדות הנדרשים');
      return;
    }
    if (this.savingCancelled()) {
      return;
    }

    const startIso = this.hebrewPartsToIso(
      this.startHebrewYearSig(),
      this.startHebrewMonthSig(),
      this.startHebrewDaySig()
    );
    const endIso = this.hebrewPartsToIso(
      this.endHebrewYearSig(),
      this.endHebrewMonthSig(),
      this.endHebrewDaySig()
    );
    if (!startIso || !endIso) {
      this.toast.error('תאריכים לא תקינים');
      return;
    }
    if (endIso < startIso) {
      this.toast.error('תאריך הסיום חייב להיות אחרי או שווה לתאריך ההתחלה');
      return;
    }

    const v = this.cancelledForm.getRawValue();
    const rawTotal = v.totalAmount;
    const totalAmount =
      rawTotal === null || rawTotal === undefined || String(rawTotal).trim() === ''
        ? null
        : Number(rawTotal);
    const payload: CreateManualCancelledOrderDto = {
      customerName: (v.customerName ?? '').trim() || null,
      phone: (v.phone ?? '').trim(),
      address: (v.address ?? '').trim() || null,
      equipmentDefinitionIds: [...(v.equipmentDefinitionIds ?? [])],
      startDate: startIso,
      endDate: endIso,
      totalAmount: totalAmount != null && Number.isFinite(totalAmount) ? totalAmount : null
    };

    this.savingCancelled.set(true);
    this.data
      .createManualCancelledOrder(payload)
      .pipe(finalize(() => this.savingCancelled.set(false)))
      .subscribe({
        next: (created) => {
          if (!created) {
            return;
          }
          this.cancelledOrders.update((list) => {
            if (list.some((o) => o.id === created.id)) {
              return list.map((o) => (o.id === created.id ? created : o));
            }
            return [created, ...list];
          });
          this.closeAddCancelled();
          this.toast.success('ההזמנה המבוטלת נוספה בהצלחה');
        }
      });
  }

  protected toggleCancelledEquipmentDropdown(): void {
    this.cancelledEquipmentDropdownOpen.update((open) => !open);
  }

  protected selectedCancelledEquipmentSummary(): string {
    const ids = this.cancelledForm.controls.equipmentDefinitionIds.value ?? [];
    if (ids.length === 0) {
      return 'בחרו ציוד…';
    }
    return ids.map((id) => this.equipmentSlots.displayLabel(id)).join(', ');
  }

  protected isCancelledEquipmentSelected(id: string): boolean {
    return (this.cancelledForm.controls.equipmentDefinitionIds.value ?? []).includes(id);
  }

  protected toggleCancelledEquipmentSelection(id: string, checked: boolean): void {
    const current = [...(this.cancelledForm.controls.equipmentDefinitionIds.value ?? [])];
    const next = checked
      ? current.includes(id)
        ? current
        : [...current, id]
      : current.filter((x) => x !== id);
    this.cancelledForm.controls.equipmentDefinitionIds.setValue(next);
    this.cancelledForm.controls.equipmentDefinitionIds.markAsTouched();
  }

  protected dayLabel(day: number): string {
    return this.hebrew.dayGematriya(day);
  }

  protected yearLabel(year: number): string {
    return this.hebrew.yearGematriya(year);
  }

  protected patchStartHebrewFromCalendar(
    part: Partial<Pick<HebrewDateParts, 'year' | 'month' | 'day'>>
  ): void {
    const patch: Record<string, number> = {};
    if (part.year !== undefined) {
      patch['startHebrewYear'] = part.year;
      this.ensureYearInStartOptions(part.year);
    }
    if (part.month !== undefined) {
      patch['startHebrewMonth'] = part.month;
    }
    if (part.day !== undefined) {
      patch['startHebrewDay'] = part.day;
    }
    if (Object.keys(patch).length > 0) {
      this.cancelledForm.patchValue(patch);
    }
  }

  protected patchEndHebrewFromCalendar(
    part: Partial<Pick<HebrewDateParts, 'year' | 'month' | 'day'>>
  ): void {
    const patch: Record<string, number> = {};
    if (part.year !== undefined) {
      patch['endHebrewYear'] = part.year;
      this.ensureYearInEndOptions(part.year);
    }
    if (part.month !== undefined) {
      patch['endHebrewMonth'] = part.month;
    }
    if (part.day !== undefined) {
      patch['endHebrewDay'] = part.day;
    }
    if (Object.keys(patch).length > 0) {
      this.cancelledForm.patchValue(patch);
    }
  }

  protected onCancelledCustomerSuggestFocus(field: 'name' | 'phone'): void {
    this.cancelledCustomerSuggestField.set(field);
    this.customerSuggestField.set(field);
    if (this.customerSuggestions().length > 0) {
      this.customerSuggestOpen.set(true);
    }
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
    const patch = {
      customerName: c.fullName ?? '',
      phone: c.phone1 ?? '',
      address: c.address ?? ''
    };
    if (this.addCancelledOpen()) {
      this.cancelledForm.patchValue(patch, { emitEvent: false });
    } else {
      this.debtForm.patchValue(patch, { emitEvent: false });
    }
    this.closeCustomerSuggestions();
  }

  protected exportCancelledToExcel(): void {
    const rows = this.cancelledOrders();
    if (rows.length === 0) {
      this.toast.show('אין הזמנות מבוטלות לייצוא', 'info');
      return;
    }
    if (this.exportCancelledInProgress()) {
      return;
    }
    this.exportCancelledInProgress.set(true);
    void this.exportSvc
      .exportToExcel(
        rows.map((o) => this.toCancelledExcelRow(o)),
        `cancelled_orders_${this.todayFileStamp()}.xlsx`
      )
      .then(() => this.toast.success('קובץ Excel הורד'))
      .finally(() => this.exportCancelledInProgress.set(false));
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
        `open_debts_${this.todayFileStamp()}.xlsx`
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

  protected deleteCancelledOrder(order: OrderDto): void {
    if (this.deletingOrderId() !== null) {
      return;
    }
    const label = order.customerName?.trim() || order.phone;
    if (!confirm(`למחוק את ההזמנה של ${label}? לא ניתן לשחזר פעולה זו.`)) {
      return;
    }

    this.deletingOrderId.set(order.id);
    this.data
      .deleteOrder(order.id)
      .pipe(finalize(() => this.deletingOrderId.set(null)))
      .subscribe({
        next: (ok) => {
          if (!ok) {
            return;
          }
          this.cancelledOrders.update((list) => list.filter((o) => o.id !== order.id));
          this.toast.success('ההזמנה נמחקה בהצלחה');
        }
      });
  }

  protected equipmentLabel(order: OrderDto): string {
    return (order.equipmentDefinitionIds ?? [])
      .map((id) => this.equipmentSlots.displayLabel(id))
      .join(', ');
  }

  protected startHebrewDate(order: OrderDto): string {
    const iso = this.firstShiftDate(order);
    if (!iso) {
      return '—';
    }
    const date = this.hebrew.parseIso(iso);
    return date ? this.hebrew.toHebrew(date) : iso;
  }

  protected endHebrewDate(order: OrderDto): string {
    const iso = this.lastShiftDate(order);
    if (!iso) {
      return '—';
    }
    const date = this.hebrew.parseIso(iso);
    return date ? this.hebrew.toHebrew(date) : iso;
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

  protected formatAmount(order: OrderDto): string {
    if (order.paymentAmount == null) {
      return '—';
    }
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      maximumFractionDigits: 0
    }).format(order.paymentAmount);
  }

  protected orderStatusLabel(order: OrderDto): string {
    return order.isCancelled ? 'מבוטלת' : 'פעילה';
  }

  private wireCustomerAutocomplete(): void {
    const name$ = this.debtForm.controls.customerName.valueChanges.pipe(map((v) => ({ source: 'debt' as const, field: 'name' as const, q: (v ?? '').trim() })));
    const phone$ = this.debtForm.controls.phone.valueChanges.pipe(map((v) => ({ source: 'debt' as const, field: 'phone' as const, q: (v ?? '').trim() })));

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
          return this.customers.searchSuggest(q).pipe(
            map((list) => list.slice(0, 8))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((list) => {
        this.customerSuggestions.set(list);
        this.customerSuggestOpen.set(list.length > 0);
        this.customerSuggestIndex.set(list.length > 0 ? 0 : -1);
      });
  }

  private wireCancelledCustomerAutocomplete(): void {
    const name$ = this.cancelledForm.controls.customerName.valueChanges.pipe(
      map((v) => ({ field: 'name' as const, q: (v ?? '').trim() }))
    );
    const phone$ = this.cancelledForm.controls.phone.valueChanges.pipe(
      map((v) => ({ field: 'phone' as const, q: (v ?? '').trim() }))
    );

    merge(name$, phone$)
      .pipe(
        debounceTime(300),
        switchMap(({ field, q }) => {
          if (!this.addCancelledOpen() || q.length < 2) {
            return EMPTY;
          }
          this.cancelledCustomerSuggestField.set(field);
          this.customerSuggestField.set(field);
          return this.customers.searchSuggest(q).pipe(map((list) => list.slice(0, 8)));
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((list) => {
        if (!this.addCancelledOpen()) {
          return;
        }
        this.customerSuggestions.set(list);
        this.customerSuggestOpen.set(list.length > 0);
        this.customerSuggestIndex.set(list.length > 0 ? 0 : -1);
      });
  }

  private wireCancelledDateForm(): void {
    const startYearCtrl = this.cancelledForm.controls.startHebrewYear;
    const startMonthCtrl = this.cancelledForm.controls.startHebrewMonth;
    const startDayCtrl = this.cancelledForm.controls.startHebrewDay;
    const endYearCtrl = this.cancelledForm.controls.endHebrewYear;
    const endMonthCtrl = this.cancelledForm.controls.endHebrewMonth;
    const endDayCtrl = this.cancelledForm.controls.endHebrewDay;

    startYearCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((year) => {
      if (typeof year !== 'number') {
        return;
      }
      this.startHebrewYearSig.set(year);
      this.startMonthOptions.set(this.hebrew.monthsForYear(year));
      const months = this.hebrew.monthsForYear(year);
      if (!months.some((m) => m.value === startMonthCtrl.value)) {
        startMonthCtrl.setValue(months[0]?.value ?? 1, { emitEvent: true });
      }
      this.syncStartDayOptions();
    });

    startMonthCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((month) => {
      if (typeof month === 'number') {
        this.startHebrewMonthSig.set(month);
        this.syncStartDayOptions();
      }
    });

    startDayCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((day) => {
      if (typeof day === 'number') {
        this.startHebrewDaySig.set(day);
      }
    });

    endYearCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((year) => {
      if (typeof year !== 'number') {
        return;
      }
      this.endHebrewYearSig.set(year);
      this.endMonthOptions.set(this.hebrew.monthsForYear(year));
      const months = this.hebrew.monthsForYear(year);
      if (!months.some((m) => m.value === endMonthCtrl.value)) {
        endMonthCtrl.setValue(months[0]?.value ?? 1, { emitEvent: true });
      }
      this.syncEndDayOptions();
    });

    endMonthCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((month) => {
      if (typeof month === 'number') {
        this.endHebrewMonthSig.set(month);
        this.syncEndDayOptions();
      }
    });

    endDayCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((day) => {
      if (typeof day === 'number') {
        this.endHebrewDaySig.set(day);
      }
    });
  }

  private buildYearOptions(): number[] {
    const current = this.hebrew.toHebrewParts(new Date()).year;
    return Array.from({ length: 11 }, (_, i) => current - 5 + i);
  }

  private buildDayOptions(month: number, year: number): number[] {
    return Array.from({ length: this.hebrew.daysInMonth(month, year) }, (_, i) => i + 1);
  }

  private syncStartDayOptions(): void {
    const year = this.startHebrewYearSig();
    const month = this.startHebrewMonthSig();
    const days = this.buildDayOptions(month, year);
    this.startDayOptions.set(days);
    const dayCtrl = this.cancelledForm.controls.startHebrewDay;
    if (typeof dayCtrl.value === 'number' && dayCtrl.value > days.length) {
      dayCtrl.setValue(days.length, { emitEvent: true });
    }
  }

  private syncEndDayOptions(): void {
    const year = this.endHebrewYearSig();
    const month = this.endHebrewMonthSig();
    const days = this.buildDayOptions(month, year);
    this.endDayOptions.set(days);
    const dayCtrl = this.cancelledForm.controls.endHebrewDay;
    if (typeof dayCtrl.value === 'number' && dayCtrl.value > days.length) {
      dayCtrl.setValue(days.length, { emitEvent: true });
    }
  }

  private ensureYearInStartOptions(year: number): void {
    this.startYearOptions.update((years) => (years.includes(year) ? years : [...years, year].sort((a, b) => a - b)));
  }

  private ensureYearInEndOptions(year: number): void {
    this.endYearOptions.update((years) => (years.includes(year) ? years : [...years, year].sort((a, b) => a - b)));
  }

  private hebrewPartsToIso(year: number, month: number, day: number): string | null {
    try {
      return this.hebrew.toIso(this.hebrew.toGregorian(year, month, day));
    } catch {
      return null;
    }
  }

  private closeCustomerSuggestions(): void {
    this.customerSuggestOpen.set(false);
    this.customerSuggestField.set(null);
    this.customerSuggestIndex.set(-1);
  }

  private toCancelledExcelRow(order: OrderDto): Record<string, unknown> {
    return {
      'שם לקוח': order.customerName ?? '',
      טלפון: order.phone,
      ציוד: this.equipmentLabel(order),
      'תאריך התחלה': this.startHebrewDate(order),
      'תאריך סיום': this.endHebrewDate(order),
      'סכום כולל': order.paymentAmount ?? '',
      סטטוס: this.orderStatusLabel(order)
    };
  }

  private firstShiftDate(order: OrderDto): string | null {
    const shifts = [...(order.shifts ?? [])].sort((a, b) => a.orderDate.localeCompare(b.orderDate));
    return shifts[0]?.orderDate ?? null;
  }

  private lastShiftDate(order: OrderDto): string | null {
    const shifts = [...(order.shifts ?? [])].sort((a, b) => a.orderDate.localeCompare(b.orderDate));
    return shifts[shifts.length - 1]?.orderDate ?? null;
  }

  private todayFileStamp(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
}
