import { CommonModule, DOCUMENT } from '@angular/common';
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
import { RouterLink } from '@angular/router';
import { forkJoin, finalize, of } from 'rxjs';

import { UnreturnedItemDto } from '../../core/models/equipment-return.model';
import { InventoryDefinitionDto } from '../../core/models/inventory-definition.model';
import { LoanedEquipmentType, LOANED_EQUIPMENT_ORDER } from '../../core/models/enums';
import { OrderDto } from '../../core/models/order.model';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { InventoryDefinitionsStore } from '../../core/services/inventory-definitions.store';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import { OrdersSyncService } from '../../core/services/orders-sync.service';
import { ToastService } from '../../core/services/toast.service';
import { CustomersStore } from '../../core/services/customers.store';

interface ActiveLoanRow {
  key: string;
  orderId: number;
  loanedEquipmentId: number;
  customerName: string;
  phone: string;
  address: string;
  accessoryName: string;
  quantity: number;
  codes: string[];
  loanDateIso: string;
  isCustomItem: boolean;
  assignedSerialCodes: string[];
  /** True when the loan comes from a full order (grid equipment), not a standalone quick loan. */
  isOrderBased: boolean;
  /** True when this loan row is a free-text one-time accessory (not permanent catalog). */
  isOneTimeItem: boolean;
  /** When set, this row is a manual "ציוד שלא חזר" report (not an order loan line). */
  manualItemId?: number | null;
}

interface ActiveLoanOrderRef {
  id: number;
  isOrderBased: boolean;
}

interface ActiveLoanCustomerCard {
  key: string;
  customerName: string;
  phone: string;
  address: string;
  customerNotes: string | null;
  orders: ActiveLoanOrderRef[];
  items: ActiveLoanRow[];
  totalQuantity: number;
}

interface QuickReturnItem {
  key: string;
  orderId: number;
  loanedEquipmentId: number;
  accessoryName: string;
  /** Specific serial being offered for return; null for quantity-only lines. */
  serialCode: string | null;
  quantity: number;
  selected: boolean;
  isScannedMatch: boolean;
}

interface QuickReturnSession {
  scannedCode: string;
  customerName: string;
  phone: string;
  address: string;
  items: QuickReturnItem[];
}

@Component({
  selector: 'app-active-loans',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink],
  templateUrl: './active-loans.component.html',
  styleUrl: './active-loans.component.scss'
})
export class ActiveLoansComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly ordersSync = inject(OrdersSyncService);
  private readonly toast = inject(ToastService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly inventoryStore = inject(InventoryDefinitionsStore);
  private readonly customers = inject(CustomersStore);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly pageTitle = inject(WorkspaceUiService).title('השאלות');

  protected readonly activeLoans = signal<OrderDto[]>([]);
  protected readonly unreturnedReports = signal<UnreturnedItemDto[]>([]);
  protected readonly activeLoading = signal(false);
  protected readonly returningLineKey = signal<string | null>(null);
  protected readonly removingLineKeys = signal<Set<string>>(new Set());

  protected readonly quickReturnTypeId = signal<number | null>(null);
  protected readonly quickReturnCode = signal('');
  protected readonly quickReturnCodeOpen = signal(false);
  protected readonly quickReturnSearching = signal(false);
  protected readonly quickReturnSaving = signal(false);
  protected readonly quickReturnSession = signal<QuickReturnSession | null>(null);
  protected readonly loanSearchQuery = signal('');

  protected readonly activeLoanRows = computed(() => this.buildActiveLoanRows(this.activeLoans()));

  protected readonly activeLoanCustomerCards = computed(() => {
    // Touch customers signal so notes refresh after profile load/upsert.
    this.customers.customers();
    const cards = this.buildActiveLoanCustomerCards(this.activeLoanRows(), this.unreturnedReports());
    return this.filterCustomerCards(cards, this.loanSearchQuery());
  });

  protected readonly quickReturnTypes = computed(() =>
    this.inventoryStore.definitions().filter((d) => (d.displayName ?? '').trim().length > 0)
  );

  protected readonly quickReturnSelectedType = computed(() => {
    const id = this.quickReturnTypeId();
    return id != null ? this.inventoryStore.byId(id) ?? null : null;
  });

  protected readonly quickReturnCodeOptions = computed(() => {
    const def = this.quickReturnSelectedType();
    if (!def) {
      return [] as string[];
    }

    const codes = new Set<string>();
    for (const row of this.activeLoanRows()) {
      // Quick return is catalog-only — skip one-time / custom free-text rows.
      if (row.isOneTimeItem || !this.rowMatchesAccessoryType(row, def)) {
        continue;
      }
      for (const code of row.assignedSerialCodes.length > 0 ? row.assignedSerialCodes : row.codes) {
        const trimmed = code.trim();
        if (trimmed) {
          codes.add(trimmed);
        }
      }
    }

    for (const unit of def.serialUnits ?? []) {
      if (unit.physicalStatus === 'LoanedOut' && unit.serialCode.trim()) {
        codes.add(unit.serialCode.trim());
      }
    }

    if (codes.size === 0) {
      for (const code of def.serialCodes ?? []) {
        const trimmed = code.trim();
        if (trimmed) {
          codes.add(trimmed);
        }
      }
    }

    const query = this.quickReturnCode().trim().toLowerCase();
    const list = [...codes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!query) {
      return list;
    }
    return list.filter((code) => code.toLowerCase().includes(query));
  });

  ngOnInit(): void {
    this.inventoryStore.load({ force: true }).subscribe();
    this.customers.load().subscribe();
    this.loadActiveLoans();

    this.ordersSync.orderChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadActiveLoans());

    this.ordersSync.unreturnedChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.loadActiveLoans());
  }

  protected formatPhone(phone: string | null | undefined): string {
    const digits = (phone ?? '').replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    if (digits.length === 9) {
      return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5)}`;
    }
    return phone ?? '';
  }

  protected refreshActiveLoans(): void {
    this.loadActiveLoans();
  }

  protected onLoanSearchInput(value: string): void {
    this.loanSearchQuery.set(value);
  }

  protected clearLoanSearch(): void {
    this.loanSearchQuery.set('');
  }

  protected activeLoanDateLabel(iso: string): string {
    if (!iso) {
      return '—';
    }
    const date = this.hebrew.parseIso(iso);
    return date ? this.hebrew.formatGregorianWithDayName(date) : iso;
  }

  protected activeLoanHebrewDate(iso: string): string {
    if (!iso) {
      return '';
    }
    const date = this.hebrew.parseIso(iso);
    return date ? this.hebrew.toHebrew(date) : '';
  }

  protected isReturningLine(row: ActiveLoanRow): boolean {
    const key = this.returningLineKey();
    return key === row.key || key === this.customerCardKey(row) || (key?.startsWith(`${row.key}::`) ?? false);
  }

  protected isReturningCode(row: ActiveLoanRow, code: string): boolean {
    return this.returningLineKey() === this.codeReturnKey(row, code);
  }

  protected isReturningCustomer(card: ActiveLoanCustomerCard): boolean {
    return this.returningLineKey() === card.key;
  }

  protected isRemovingLine(row: ActiveLoanRow): boolean {
    return this.removingLineKeys().has(row.key);
  }

  protected isRemovingCode(row: ActiveLoanRow, code: string): boolean {
    return this.removingLineKeys().has(this.codeReturnKey(row, code));
  }

  protected isRemovingCustomer(card: ActiveLoanCustomerCard): boolean {
    return this.removingLineKeys().has(card.key);
  }

  protected markLineReturned(row: ActiveLoanRow): void {
    if (this.returningLineKey() !== null) {
      return;
    }

    if (row.manualItemId != null && row.manualItemId > 0) {
      this.resolveManualLoanRow(row);
      return;
    }

    const assignedCodes = row.assignedSerialCodes;
    const hasSerializedLine = assignedCodes.length > 0;
    const quantityReturned = hasSerializedLine ? assignedCodes.length : row.quantity;

    this.returningLineKey.set(row.key);
    this.data
      .recordOrderReturn(row.orderId, {
        items: [
          {
            loanedEquipmentId: row.loanedEquipmentId,
            quantityReturned,
            ...(hasSerializedLine ? { returnedSerialCodes: [...assignedCodes] } : {})
          }
        ]
      })
      .pipe(finalize(() => this.returningLineKey.set(null)))
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.ordersSync.notifyOrderUpdated(updated);
        this.animateActiveLineOut(row.key);
        this.toast.success('הפריט סומן כהוחזר');
        this.loadActiveLoans();
        this.inventoryStore.load({ force: true }).subscribe();
      });
  }

  protected markCodeReturned(row: ActiveLoanRow, code: string): void {
    if (this.returningLineKey() !== null) {
      return;
    }

    if (row.manualItemId != null && row.manualItemId > 0) {
      this.resolveManualLoanRow(row);
      return;
    }

    const trimmed = code.trim();
    if (!trimmed) {
      return;
    }

    const returnKey = this.codeReturnKey(row, trimmed);
    this.returningLineKey.set(returnKey);
    this.data
      .recordOrderReturn(row.orderId, {
        items: [
          {
            loanedEquipmentId: row.loanedEquipmentId,
            quantityReturned: 1,
            returnedSerialCodes: [trimmed]
          }
        ]
      })
      .pipe(finalize(() => this.returningLineKey.set(null)))
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.ordersSync.notifyOrderUpdated(updated);
        this.animateActiveLineOut(returnKey);
        this.toast.success(`קוד ${trimmed} סומן כהוחזר`);
        this.loadActiveLoans();
        this.inventoryStore.load({ force: true }).subscribe();
      });
  }

  protected markCustomerAllReturned(card: ActiveLoanCustomerCard): void {
    if (this.returningLineKey() !== null || card.items.length === 0) {
      return;
    }

    type LineReturn = {
      loanedEquipmentId: number;
      serialCodes: string[];
      quantityOnly: number;
    };
    const byOrder = new Map<number, LineReturn[]>();
    const manualIds: number[] = [];

    for (const row of card.items) {
      if (row.manualItemId != null && row.manualItemId > 0) {
        manualIds.push(row.manualItemId);
        continue;
      }

      const list = byOrder.get(row.orderId) ?? [];
      const assignedCodes = row.assignedSerialCodes;
      if (assignedCodes.length > 0) {
        list.push({
          loanedEquipmentId: row.loanedEquipmentId,
          serialCodes: [...assignedCodes],
          quantityOnly: 0
        });
      } else {
        list.push({
          loanedEquipmentId: row.loanedEquipmentId,
          serialCodes: [],
          quantityOnly: row.quantity
        });
      }
      byOrder.set(row.orderId, list);
    }

    const orderRequests = [...byOrder.entries()].map(([orderId, lines]) =>
      this.data.recordOrderReturn(orderId, {
        items: lines.map((line) => {
          if (line.serialCodes.length > 0) {
            return {
              loanedEquipmentId: line.loanedEquipmentId,
              quantityReturned: line.serialCodes.length,
              returnedSerialCodes: [...line.serialCodes]
            };
          }
          return {
            loanedEquipmentId: line.loanedEquipmentId,
            quantityReturned: line.quantityOnly
          };
        })
      })
    );

    const manualRequests = manualIds.map((id) => this.data.resolveManualUnreturnedItem(id));
    if (orderRequests.length === 0 && manualRequests.length === 0) {
      return;
    }

    this.returningLineKey.set(card.key);
    forkJoin({
      orders: orderRequests.length > 0 ? forkJoin(orderRequests) : of([] as (OrderDto | null)[]),
      manuals: manualRequests.length > 0 ? forkJoin(manualRequests) : of([] as boolean[])
    })
      .pipe(finalize(() => this.returningLineKey.set(null)))
      .subscribe(({ orders, manuals }) => {
        const updatedOrders = orders.filter((r): r is OrderDto => !!r);
        const resolvedManual = manuals.filter((ok) => ok).length;
        if (updatedOrders.length === 0 && resolvedManual === 0) {
          return;
        }
        for (const order of updatedOrders) {
          this.ordersSync.notifyOrderUpdated(order);
        }
        if (resolvedManual > 0) {
          this.ordersSync.notifyUnreturnedChanged(null);
        }
        this.animateActiveLineOut(card.key);
        this.toast.success(
          card.items.length === 1
            ? 'כל הפריטים של הלקוח סומנו כהוחזרו'
            : `${card.totalQuantity} פריטים סומנו כהוחזרו`
        );
        this.loadActiveLoans();
        this.inventoryStore.load({ force: true }).subscribe();
      });
  }

  private resolveManualLoanRow(row: ActiveLoanRow): void {
    const manualItemId = row.manualItemId;
    if (manualItemId == null || manualItemId <= 0) {
      return;
    }

    this.returningLineKey.set(row.key);
    this.data
      .resolveManualUnreturnedItem(manualItemId)
      .pipe(finalize(() => this.returningLineKey.set(null)))
      .subscribe((ok) => {
        if (!ok) {
          return;
        }
        this.unreturnedReports.update((list) =>
          list.filter((r) => r.manualItemId !== manualItemId)
        );
        this.ordersSync.notifyUnreturnedChanged(null);
        this.animateActiveLineOut(row.key);
        this.toast.success('הפריט סומן כהוחזר');
        this.inventoryStore.load({ force: true }).subscribe();
      });
  }

  protected activeLoanOrderLabelForId(order: ActiveLoanOrderRef): string {
    return order.isOrderBased ? `הזמנה #${order.id}` : `השאלה #${order.id}`;
  }

  protected onQuickReturnKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.quickReturnCodeOpen.set(false);
      return;
    }
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    const options = this.quickReturnCodeOptions();
    const typed = this.quickReturnCode().trim();
    if (options.length === 1 && typed) {
      this.selectQuickReturnCode(options[0]);
    }
    this.searchQuickReturn();
  }

  protected onQuickReturnTypeChange(raw: string): void {
    const id = Number.parseInt(raw, 10);
    this.quickReturnTypeId.set(Number.isFinite(id) && id > 0 ? id : null);
    this.quickReturnCode.set('');
    this.quickReturnCodeOpen.set(false);
  }

  protected onQuickReturnCodeFocus(): void {
    if (this.quickReturnTypeId() != null) {
      this.quickReturnCodeOpen.set(true);
    }
  }

  protected onQuickReturnCodeBlur(): void {
    setTimeout(() => this.quickReturnCodeOpen.set(false), 150);
  }

  protected onQuickReturnCodeInput(raw: string): void {
    this.quickReturnCode.set(raw);
    if (this.quickReturnTypeId() != null) {
      this.quickReturnCodeOpen.set(true);
    }
  }

  protected selectQuickReturnCode(code: string, event?: Event): void {
    event?.preventDefault();
    this.quickReturnCode.set(code);
    this.quickReturnCodeOpen.set(false);
  }

  protected searchQuickReturn(): void {
    if (this.quickReturnSearching() || this.quickReturnSaving()) {
      return;
    }

    const def = this.quickReturnSelectedType();
    if (!def) {
      this.toast.warning('יש לבחור סוג אביזר מהמלאי הקבוע');
      return;
    }

    const code = this.quickReturnCode().trim();
    if (!code) {
      this.toast.warning('יש לבחור או להזין קוד פריט או שם אביזר');
      return;
    }

    const openFromRows = (): void => {
      let matches = this.findActiveLoansByAccessoryCode(code).filter(
        (row) => !row.isOneTimeItem && this.rowMatchesAccessoryType(row, def)
      );

      // Also allow matching the permanent accessory display name (catalog only).
      if (matches.length === 0) {
        const needle = code.toLowerCase();
        matches = this.activeLoanRows().filter(
          (row) =>
            !row.isOneTimeItem &&
            this.rowMatchesAccessoryType(row, def) &&
            (row.accessoryName.toLowerCase().includes(needle) ||
              def.displayName.toLowerCase().includes(needle))
        );
      }

      if (matches.length === 0) {
        this.toast.warning(`לא נמצאה השאלה פעילה עבור ${def.displayName} עם קוד "${code}"`);
        queueMicrotask(() => this.focusQuickReturnCodeInput());
        return;
      }

      const phoneKeys = new Set(
        matches.map((m) => this.normalizePhone(m.phone)).filter((p) => p.length > 0)
      );
      if (phoneKeys.size > 1) {
        this.toast.warning('נמצאו מספר לקוחות עם אותו קוד — בחרו מהרשימה למטה');
        queueMicrotask(() => this.focusQuickReturnCodeInput());
        return;
      }

      const match = matches[0];
      const phoneKey = this.normalizePhone(match.phone);
      const customerRows = this.activeLoanRows().filter(
        (row) =>
          !row.isOneTimeItem &&
          this.normalizePhone(row.phone) === phoneKey &&
          phoneKey.length > 0
      );
      const items = this.buildQuickReturnItems(
        customerRows.length > 0 ? customerRows : [match],
        match,
        code
      );

      this.quickReturnSession.set({
        scannedCode: code,
        customerName: match.customerName,
        phone: match.phone,
        address: match.address,
        items
      });
    };

    // Always refresh from server so lookups see the latest active loans.
    this.quickReturnSearching.set(true);
    this.data
      .getQuickLoans()
      .pipe(finalize(() => this.quickReturnSearching.set(false)))
      .subscribe((orders) => {
        this.activeLoans.set(orders);
        this.activeLoading.set(false);
        openFromRows();
      });
  }

  protected closeQuickReturnModal(): void {
    if (this.quickReturnSaving()) {
      return;
    }
    this.quickReturnSession.set(null);
    queueMicrotask(() => this.focusQuickReturnCodeInput());
  }

  protected quickReturnScannedItem(session: QuickReturnSession): QuickReturnItem | null {
    return session.items.find((item) => item.isScannedMatch) ?? null;
  }

  protected quickReturnAdditionalItems(session: QuickReturnSession): QuickReturnItem[] {
    return session.items.filter((item) => !item.isScannedMatch);
  }

  protected toggleQuickReturnItem(key: string, checked: boolean): void {
    this.quickReturnSession.update((session) => {
      if (!session) {
        return session;
      }
      return {
        ...session,
        items: session.items.map((item) => {
          if (item.key !== key) {
            return item;
          }
          // Scanned match stays selected — it is the reason the dialog opened.
          if (item.isScannedMatch && !checked) {
            return item;
          }
          return { ...item, selected: checked };
        })
      };
    });
  }

  protected confirmQuickReturn(): void {
    const session = this.quickReturnSession();
    if (!session || this.quickReturnSaving()) {
      return;
    }

    const selected = session.items.filter((item) => item.selected);
    if (selected.length === 0) {
      this.toast.warning('יש לבחור לפחות אביזר אחד להחזרה');
      return;
    }

    type LineReturn = {
      orderId: number;
      loanedEquipmentId: number;
      serialCodes: string[];
      quantityOnly: number;
    };
    const byOrderLine = new Map<string, LineReturn>();

    for (const item of selected) {
      const lineKey = `${item.orderId}:${item.loanedEquipmentId}`;
      let entry = byOrderLine.get(lineKey);
      if (!entry) {
        entry = {
          orderId: item.orderId,
          loanedEquipmentId: item.loanedEquipmentId,
          serialCodes: [],
          quantityOnly: 0
        };
        byOrderLine.set(lineKey, entry);
      }
      if (item.serialCode) {
        if (
          !entry.serialCodes.some(
            (c) => c.localeCompare(item.serialCode!, undefined, { sensitivity: 'accent' }) === 0
          )
        ) {
          entry.serialCodes.push(item.serialCode);
        }
      } else {
        entry.quantityOnly += Math.max(1, item.quantity);
      }
    }

    const byOrder = new Map<number, LineReturn[]>();
    for (const entry of byOrderLine.values()) {
      const list = byOrder.get(entry.orderId) ?? [];
      list.push(entry);
      byOrder.set(entry.orderId, list);
    }

    const requests = [...byOrder.entries()].map(([orderId, lines]) =>
      this.data.recordOrderReturn(orderId, {
        items: lines.map((line) => {
          if (line.serialCodes.length > 0) {
            return {
              loanedEquipmentId: line.loanedEquipmentId,
              quantityReturned: line.serialCodes.length,
              returnedSerialCodes: [...line.serialCodes]
            };
          }
          return {
            loanedEquipmentId: line.loanedEquipmentId,
            quantityReturned: line.quantityOnly
          };
        })
      })
    );

    this.quickReturnSaving.set(true);
    forkJoin(requests)
      .pipe(finalize(() => this.quickReturnSaving.set(false)))
      .subscribe((results) => {
        const updated = results.filter((r): r is OrderDto => !!r);
        if (updated.length === 0) {
          return;
        }
        for (const order of updated) {
          this.ordersSync.notifyOrderUpdated(order);
        }
        this.quickReturnSession.set(null);
        this.resetQuickReturnSelection();
        this.toast.success(
          selected.length === 1
            ? 'הקוד הוחזר בהצלחה'
            : `${selected.length} קודים הוחזרו בהצלחה`
        );
        this.loadActiveLoans();
        this.inventoryStore.load({ force: true }).subscribe();
        queueMicrotask(() => this.focusQuickReturnCodeInput());
      });
  }

  private filterCustomerCards(
    cards: ActiveLoanCustomerCard[],
    rawQuery: string
  ): ActiveLoanCustomerCard[] {
    const query = rawQuery.trim().toLowerCase();
    if (!query) {
      return cards;
    }

    const digitsQuery = query.replace(/\D/g, '');

    return cards.filter((card) => {
      if (card.customerName.toLowerCase().includes(query)) {
        return true;
      }
      if (card.address.toLowerCase().includes(query)) {
        return true;
      }
      const phoneDigits = this.normalizePhone(card.phone);
      if (digitsQuery && phoneDigits.includes(digitsQuery)) {
        return true;
      }
      if (card.phone.toLowerCase().includes(query)) {
        return true;
      }
      if (card.orders.some((o) => String(o.id).includes(query) || String(o.id).includes(digitsQuery))) {
        return true;
      }
      return card.items.some((item) => {
        if (item.accessoryName.toLowerCase().includes(query)) {
          return true;
        }
        if (item.isOneTimeItem && 'חד-פעמי'.includes(query)) {
          return true;
        }
        return (
          item.assignedSerialCodes.some((c) => c.toLowerCase().includes(query)) ||
          item.codes.some((c) => c.toLowerCase().includes(query))
        );
      });
    });
  }

  private customerCardKey(row: Pick<ActiveLoanRow, 'customerName' | 'phone'>): string {
    return `${row.customerName.trim()}|${this.normalizePhone(row.phone)}`;
  }

  private codeReturnKey(row: ActiveLoanRow, code: string): string {
    return `${row.key}::${code.trim()}`;
  }

  private buildActiveLoanCustomerCards(
    rows: ActiveLoanRow[],
    unreturned: UnreturnedItemDto[]
  ): ActiveLoanCustomerCard[] {
    const byCustomer = new Map<string, ActiveLoanCustomerCard>();

    for (const row of rows) {
      const key = this.customerCardKey(row);
      let card = byCustomer.get(key);
      if (!card) {
        card = {
          key,
          customerName: row.customerName,
          phone: row.phone,
          address: row.address,
          customerNotes: this.customers.notesForPhone(row.phone),
          orders: [],
          items: [],
          totalQuantity: 0
        };
        byCustomer.set(key, card);
      }

      if (!card.address && row.address) {
        card.address = row.address;
      }
      if (!card.customerNotes) {
        card.customerNotes = this.customers.notesForPhone(row.phone);
      }
      if (!card.orders.some((o) => o.id === row.orderId)) {
        card.orders.push({ id: row.orderId, isOrderBased: row.isOrderBased });
      }
      card.items.push(row);
      card.totalQuantity += row.quantity;
    }

    const manualReports = unreturned.filter(
      (r) => r.manualItemId != null && r.manualItemId > 0
    );

    for (const report of manualReports) {
      const manualItemId = report.manualItemId!;
      const code = (report.missingSerialCodes?.[0] ?? '').trim();
      const codes = code ? [code] : [];
      const accessoryName = report.equipmentName;
      const reportRow: ActiveLoanRow = {
        key: `manual-${manualItemId}`,
        orderId: report.orderId > 0 ? report.orderId : 0,
        loanedEquipmentId: 0,
        customerName: (report.customerName ?? '').trim() || 'ללא שם',
        phone: report.phone ?? '',
        address: (report.address ?? '').trim(),
        accessoryName,
        quantity: report.missingQuantity > 0 ? report.missingQuantity : 1,
        codes,
        loanDateIso: report.returnDate,
        isCustomItem: report.isCustomItem || !report.inventoryDefinitionId,
        isOneTimeItem:
          report.manualItemId != null && report.manualItemId > 0
            ? !report.inventoryDefinitionId
            : this.isOneTimeAccessoryName(accessoryName, report.isCustomItem),
        assignedSerialCodes: codes,
        isOrderBased: report.orderId > 0,
        manualItemId
      };

      const matchKey = this.findCustomerCardKeyForReport(report, byCustomer);
      if (matchKey) {
        const card = byCustomer.get(matchKey)!;
        if (!card.items.some((item) => item.manualItemId === manualItemId)) {
          card.items.push(reportRow);
          card.totalQuantity += reportRow.quantity;
        }
        if (reportRow.orderId > 0 && !card.orders.some((o) => o.id === reportRow.orderId)) {
          card.orders.push({ id: reportRow.orderId, isOrderBased: true });
        }
        if (!card.address && reportRow.address) {
          card.address = reportRow.address;
        }
        continue;
      }

      const key = this.customerCardKey(reportRow);
      byCustomer.set(key, {
        key,
        customerName: reportRow.customerName,
        phone: reportRow.phone,
        address: reportRow.address,
        customerNotes: this.customers.notesForPhone(reportRow.phone),
        orders:
          reportRow.orderId > 0 ? [{ id: reportRow.orderId, isOrderBased: true }] : [],
        items: [reportRow],
        totalQuantity: reportRow.quantity
      });
    }

    return [...byCustomer.values()].sort((a, b) => {
      const nameCmp = a.customerName.localeCompare(b.customerName, 'he');
      if (nameCmp !== 0) {
        return nameCmp;
      }
      return a.phone.localeCompare(b.phone, 'he');
    });
  }

  private findCustomerCardKeyForReport(
    report: UnreturnedItemDto,
    cards: Map<string, ActiveLoanCustomerCard>
  ): string | null {
    const phone = this.normalizePhone(report.phone);
    if (phone.length >= 7) {
      for (const [key, card] of cards) {
        if (this.normalizePhone(card.phone) === phone) {
          return key;
        }
      }
    }

    const name = (report.customerName ?? '').trim().toLowerCase();
    if (name.length > 0) {
      for (const [key, card] of cards) {
        if (card.customerName.trim().toLowerCase() === name) {
          return key;
        }
      }
    }

    return null;
  }

  private buildQuickReturnItems(
    customerRows: ActiveLoanRow[],
    match: ActiveLoanRow,
    scannedCode: string
  ): QuickReturnItem[] {
    const items: QuickReturnItem[] = [];

    for (const row of customerRows) {
      const outstandingCodes =
        row.assignedSerialCodes.length > 0 ? row.assignedSerialCodes : row.codes;

      if (outstandingCodes.length > 0) {
        for (const code of outstandingCodes) {
          const isScannedMatch =
            row.key === match.key &&
            code.localeCompare(scannedCode, undefined, { sensitivity: 'accent' }) === 0;
          items.push({
            key: `${row.key}::${code}`,
            orderId: row.orderId,
            loanedEquipmentId: row.loanedEquipmentId,
            accessoryName: row.accessoryName,
            serialCode: code,
            quantity: 1,
            selected: isScannedMatch,
            isScannedMatch
          });
        }
        continue;
      }

      // Quantity-only line (no serial codes): keep as a single selectable unit.
      const isScannedMatch = row.key === match.key;
      items.push({
        key: row.key,
        orderId: row.orderId,
        loanedEquipmentId: row.loanedEquipmentId,
        accessoryName: row.accessoryName,
        serialCode: null,
        quantity: row.quantity,
        selected: isScannedMatch,
        isScannedMatch
      });
    }

    // Put the scanned match first for readability.
    items.sort((a, b) => Number(b.isScannedMatch) - Number(a.isScannedMatch));
    return items;
  }

  private resetQuickReturnSelection(): void {
    this.quickReturnTypeId.set(null);
    this.quickReturnCode.set('');
    this.quickReturnCodeOpen.set(false);
  }

  private rowMatchesAccessoryType(row: ActiveLoanRow, def: InventoryDefinitionDto): boolean {
    if (
      row.accessoryName.localeCompare(def.displayName, 'he', { sensitivity: 'accent' }) === 0
    ) {
      return true;
    }
    const linked = def.linkedEquipmentType as LoanedEquipmentType | null | undefined;
    if (linked && LOANED_EQUIPMENT_ORDER.includes(linked)) {
      const linkedLabel = this.inventoryStore.displayLabelForType(linked);
      if (
        linkedLabel &&
        row.accessoryName.localeCompare(linkedLabel, 'he', { sensitivity: 'accent' }) === 0
      ) {
        return true;
      }
    }
    return false;
  }

  private findActiveLoansByAccessoryCode(rawCode: string): ActiveLoanRow[] {
    const code = rawCode.trim();
    if (!code) {
      return [];
    }

    return this.activeLoanRows().filter(
      (row) =>
        row.assignedSerialCodes.some(
          (c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
        ) ||
        row.codes.some(
          (c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
        )
    );
  }

  private normalizePhone(phone: string | null | undefined): string {
    return (phone ?? '').replace(/\D/g, '');
  }

  private focusQuickReturnCodeInput(): void {
    const input = this.document.getElementById(
      'quick-return-code-input'
    ) as HTMLInputElement | null;
    input?.focus();
    input?.select();
  }

  private animateActiveLineOut(key: string): void {
    this.removingLineKeys.update((set) => new Set(set).add(key));
    window.setTimeout(() => {
      this.removingLineKeys.update((set) => {
        const next = new Set(set);
        next.delete(key);
        return next;
      });
    }, 280);
  }

  private buildActiveLoanRows(orders: OrderDto[]): ActiveLoanRow[] {
    const rows: ActiveLoanRow[] = [];
    for (const order of orders) {
      if (order.isReturnProcessed || order.isCancelled) {
        continue;
      }
      const loanDateIso = order.shifts?.[0]?.orderDate ?? '';
      const isOrderBased = (order.equipmentDefinitionIds?.length ?? 0) > 0;
      for (const le of order.loanedEquipments ?? []) {
        if (le.id == null || le.quantity <= 0) {
          continue;
        }
        const returned = le.returnedQuantity ?? 0;
        if (returned >= le.quantity) {
          continue;
        }
        const codes = (le.notes ?? [])
          .filter((n) => !n.isReturned)
          .map((n) => (n.content ?? '').trim())
          .filter((c) => c.length > 0);
        const allCodes = (le.notes ?? [])
          .map((n) => (n.content ?? '').trim())
          .filter((c) => c.length > 0);
        const accessoryName = le.isCustomItem
          ? (le.customItemName?.trim() || 'פריט נוסף')
          : le.loanedEquipmentType
            ? this.inventoryStore.displayLabelForType(le.loanedEquipmentType)
            : 'פריט';
        rows.push({
          key: `${order.id}-${le.id}`,
          orderId: order.id,
          loanedEquipmentId: le.id,
          customerName: order.customerName?.trim() || 'ללא שם',
          phone: order.phone,
          address: order.address?.trim() || '',
          accessoryName,
          quantity: le.quantity - returned,
          codes: codes.length > 0 ? codes : allCodes,
          loanDateIso,
          isCustomItem: !!le.isCustomItem,
          isOneTimeItem: this.isOneTimeAccessoryName(accessoryName, !!le.isCustomItem),
          assignedSerialCodes: codes.length > 0 ? codes : allCodes,
          isOrderBased
        });
      }
    }
    return rows;
  }

  /** Free-text loan names that are not in the permanent inventory catalog. */
  private isOneTimeAccessoryName(accessoryName: string, flaggedCustom: boolean): boolean {
    if (!flaggedCustom) {
      return false;
    }
    const name = accessoryName.trim().toLowerCase();
    if (!name) {
      return true;
    }
    return !this.inventoryStore
      .definitions()
      .some((d) => d.displayName.trim().toLowerCase() === name);
  }

  private loadActiveLoans(): void {
    this.activeLoading.set(true);
    forkJoin({
      orders: this.data.getQuickLoans(),
      unreturned: this.data.getUnreturnedItems()
    })
      .pipe(finalize(() => this.activeLoading.set(false)))
      .subscribe({
        next: ({ orders, unreturned }) => {
          this.activeLoans.set(orders);
          this.unreturnedReports.set(unreturned);
        },
        error: () => {
          this.activeLoans.set([]);
          this.unreturnedReports.set([]);
        }
      });
  }
}
