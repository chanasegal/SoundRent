import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import { OrderDto } from '../../core/models/order.model';
import { DataService } from '../../core/services/data.service';
import { EquipmentDefinitionsStore } from '../../core/services/equipment-definitions.store';
import { ExportService } from '../../core/services/export.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';

type ReportsTab = 'cancelled' | 'unpaid';

@Component({
  selector: 'app-reports-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink],
  templateUrl: './reports-view.component.html',
  styleUrl: './reports-view.component.scss'
})
export class ReportsViewComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly exportSvc = inject(ExportService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly equipmentSlots = inject(EquipmentDefinitionsStore);
  private readonly toast = inject(ToastService);

  protected readonly activeTab = signal<ReportsTab>('cancelled');
  protected readonly cancelledOrders = signal<OrderDto[]>([]);
  protected readonly unpaidOrders = signal<OrderDto[]>([]);
  protected readonly loadingCancelled = signal(false);
  protected readonly loadingUnpaid = signal(false);
  protected readonly exportCancelledInProgress = signal(false);
  protected readonly exportUnpaidInProgress = signal(false);
  protected readonly markingPaidId = signal<number | null>(null);
  protected readonly deletingOrderId = signal<number | null>(null);

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
      .getUnpaidOrdersReport()
      .pipe(finalize(() => this.loadingUnpaid.set(false)))
      .subscribe({
        next: (orders) => this.unpaidOrders.set(orders)
      });
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
        rows.map((o) => this.toExcelRow(o)),
        `cancelled_orders_${this.todayFileStamp()}.xlsx`
      )
      .then(() => this.toast.success('קובץ Excel הורד'))
      .finally(() => this.exportCancelledInProgress.set(false));
  }

  protected exportUnpaidToExcel(): void {
    const rows = this.unpaidOrders();
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
        rows.map((o) => this.toExcelRow(o, true)),
        `unpaid_orders_${this.todayFileStamp()}.xlsx`
      )
      .then(() => this.toast.success('קובץ Excel הורד'))
      .finally(() => this.exportUnpaidInProgress.set(false));
  }

  protected markAsPaid(order: OrderDto): void {
    if (this.markingPaidId() !== null) {
      return;
    }
    this.markingPaidId.set(order.id);
    this.data
      .markOrderAsPaid(order.id)
      .pipe(finalize(() => this.markingPaidId.set(null)))
      .subscribe({
        next: (updated) => {
          if (updated === null) {
            return;
          }
          this.unpaidOrders.update((list) => list.filter((o) => o.id !== order.id));
          this.toast.success('ההזמנה סומנה כשולמה');
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

  private toExcelRow(order: OrderDto, includeStatus = false): Record<string, unknown> {
    const row: Record<string, unknown> = {
      'שם לקוח': order.customerName ?? '',
      טלפון: order.phone,
      ציוד: this.equipmentLabel(order),
      'תאריך התחלה': this.startHebrewDate(order),
      'תאריך סיום': this.endHebrewDate(order),
      'סכום כולל': order.paymentAmount ?? ''
    };
    if (includeStatus) {
      row['סטטוס'] = this.orderStatusLabel(order);
    }
    return row;
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
