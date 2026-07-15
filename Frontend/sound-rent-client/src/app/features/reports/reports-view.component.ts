import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { OrderDto } from '../../core/models/order.model';
import { OpenDebtGroupDto } from '../../core/models/open-debt.model';
import { CalendarViewStateService } from '../../core/services/calendar-view-state.service';
import { DataService } from '../../core/services/data.service';
import { EquipmentDefinitionsStore } from '../../core/services/equipment-definitions.store';
import { ExportService } from '../../core/services/export.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';

type ReportsTab = 'cancelled' | 'unpaid';
type DebtCategoryFilter = 'all' | 'כלי עבודה' | 'הגברה' | 'ספריה';

@Component({
  selector: 'app-reports-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, FormsModule],
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
