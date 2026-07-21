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

import { CustomerDto } from '../../core/models/customer.model';
import {
  CreateOpenDebtDto,
  DEBT_CATEGORY_OPTIONS,
  DebtCategory,
  OpenDebtGroupDto
} from '../../core/models/open-debt.model';
import { OrderDto } from '../../core/models/order.model';
import { CalendarViewStateService } from '../../core/services/calendar-view-state.service';
import { CustomersStore } from '../../core/services/customers.store';
import { DataService } from '../../core/services/data.service';
import { EquipmentDefinitionsStore } from '../../core/services/equipment-definitions.store';
import { ExportService } from '../../core/services/export.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { OrdersSyncService } from '../../core/services/orders-sync.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import {
  ISRAELI_PHONE_INVALID_MESSAGE,
  israeliPhoneValidator
} from '../../core/validators/israeli-phone.validator';
import { IsraeliPhoneInputDirective } from '../../shared/directives/israeli-phone-input.directive';

type ReportsTab = 'cancelled' | 'unpaid';
type DebtCategoryFilter = 'all' | 'כלי עבודה' | 'הגברה' | 'ספריה';

@Component({
  selector: 'app-reports-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, FormsModule, ReactiveFormsModule, IsraeliPhoneInputDirective],
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
  private readonly ordersSync = inject(OrdersSyncService);
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
  protected readonly customerSuggestions = signal<CustomerDto[]>([]);
  protected readonly customerSuggestOpen = signal(false);
  protected readonly customerSuggestField = signal<'name' | 'phone' | null>(null);
  protected readonly customerSuggestIndex = signal(-1);

  protected readonly addCancelledOpen = signal(false);
  protected readonly lookingUpOrder = signal(false);
  protected readonly cancellingOrder = signal(false);
  protected readonly cancelLookupOrder = signal<OrderDto | null>(null);
  protected readonly cancelOrderIdInput = signal('');

  protected readonly debtForm = this.fb.group({
    customerName: ['', [Validators.maxLength(200)]],
    phone: ['', [Validators.required, Validators.maxLength(20), israeliPhoneValidator()]],
    address: ['', [Validators.maxLength(300)]],
    category: ['Amplification' as DebtCategory],
    itemDescription: ['', [Validators.maxLength(300)]],
    deposit: ['', [Validators.maxLength(500)]],
    amount: [null as number | null, [Validators.required, Validators.min(0.01)]]
  });

  protected readonly filteredOpenDebts = computed(() => {
    const filter = this.debtCategoryFilter();
    const rows = this.openDebtGroups();
    if (filter === 'all') {
      return rows;
    }
    return rows.filter((r) => r.categoryLabel === filter);
  });

  ngOnInit(): void {
    this.equipmentSlots.load().subscribe();
    this.wireCustomerAutocomplete();
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
    this.cancelOrderIdInput.set('');
    this.cancelLookupOrder.set(null);
    this.addCancelledOpen.set(true);
  }

  protected closeAddCancelled(): void {
    this.addCancelledOpen.set(false);
    this.cancelLookupOrder.set(null);
    this.cancelOrderIdInput.set('');
  }

  protected lookupCancelOrder(): void {
    const raw = this.cancelOrderIdInput().trim();
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      this.toast.error('יש להזין מספר הזמנה תקין');
      return;
    }
    if (this.lookingUpOrder()) {
      return;
    }

    this.lookingUpOrder.set(true);
    this.data
      .getOrderById(id)
      .pipe(finalize(() => this.lookingUpOrder.set(false)))
      .subscribe({
        next: (order) => {
          if (!order) {
            this.cancelLookupOrder.set(null);
            return;
          }
          if (order.isCancelled) {
            this.cancelLookupOrder.set(null);
            this.toast.show('ההזמנה כבר מבוטלת', 'info');
            return;
          }
          this.cancelLookupOrder.set(order);
        }
      });
  }

  protected submitCancelOrder(): void {
    const order = this.cancelLookupOrder();
    if (!order || this.cancellingOrder()) {
      return;
    }

    this.cancellingOrder.set(true);
    this.data
      .cancelOrder(order.id)
      .pipe(finalize(() => this.cancellingOrder.set(false)))
      .subscribe({
        next: (updated) => {
          if (!updated) {
            return;
          }
          this.ordersSync.notifyOrderUpdated(updated);
          this.cancelledOrders.update((list) => {
            if (list.some((o) => o.id === updated.id)) {
              return list.map((o) => (o.id === updated.id ? updated : o));
            }
            return [updated, ...list];
          });
          this.closeAddCancelled();
          this.toast.success('ההזמנה סומנה כמבוטלת');
        }
      });
  }

  protected customerSuggestLabel(c: CustomerDto): string {
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

  protected selectCustomerSuggestion(c: CustomerDto, event?: Event): void {
    event?.preventDefault();
    this.debtForm.patchValue(
      {
        customerName: c.fullName ?? '',
        phone: c.phone1 ?? '',
        address: c.address ?? ''
      },
      { emitEvent: false }
    );
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
    const name$ = this.debtForm.controls.customerName.valueChanges.pipe(map((v) => ({ field: 'name' as const, q: (v ?? '').trim() })));
    const phone$ = this.debtForm.controls.phone.valueChanges.pipe(map((v) => ({ field: 'phone' as const, q: (v ?? '').trim() })));

    merge(name$, phone$)
      .pipe(
        debounceTime(200),
        switchMap(({ field, q }) => {
          if (q.length < 2) {
            this.customerSuggestions.set([]);
            this.customerSuggestOpen.set(false);
            return EMPTY;
          }
          this.customerSuggestField.set(field);
          return this.customers.searchGlobal(q).pipe(
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
