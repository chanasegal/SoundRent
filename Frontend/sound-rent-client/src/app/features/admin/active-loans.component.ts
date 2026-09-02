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
import { Router, RouterLink } from '@angular/router';
import { forkJoin, finalize, of } from 'rxjs';

import { UnreturnedItemDto } from '../../core/models/equipment-return.model';
import { InventoryDefinitionDto } from '../../core/models/inventory-definition.model';
import {
  DEPOSIT_TYPE_LABELS,
  DepositType,
  LoanedEquipmentType,
  LOANED_EQUIPMENT_ORDER,
  LOANED_EQUIPMENT_LABELS
} from '../../core/models/enums';
import { OrderDto } from '../../core/models/order.model';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { InventoryDefinitionsStore } from '../../core/services/inventory-definitions.store';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import { OrdersSyncService } from '../../core/services/orders-sync.service';
import { ToastService } from '../../core/services/toast.service';
import { CustomersStore } from '../../core/services/customers.store';
import { ClickOutsideDirective } from '../../shared/directives/click-outside.directive';
import { sortNumericCodes } from '../../core/utils/numeric-code-sort';
import { startLiveDataRefresh } from '../../core/utils/live-data-refresh';

interface ActiveLoanRow {
  key: string;
  orderId: number;
  loanedEquipmentId: number;
  customerName: string;
  phone: string;
  address: string;
  accessoryName: string;
  /** Outstanding (not yet returned) quantity. */
  quantity: number;
  /** Original loaned quantity on the line (used for absolute quantity returns). */
  quantityLoaned: number;
  codes: string[];
  loanDateIso: string;
  isCustomItem: boolean;
  assignedSerialCodes: string[];
  /** True when the loan comes from a full order (grid equipment), not a standalone quick loan. */
  isOrderBased: boolean;
  /** True when this loan row is a free-text one-time accessory (not permanent catalog). */
  isOneTimeItem: boolean;
  /** Order-level deposit text (type + name), when present. */
  deposit: string | null;
  /** Order-level notes from the loan form. */
  loanNotes: string | null;
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
  /** Newest loan date among items — used for card ordering. */
  loanDateIso: string;
  customerNotes: string | null;
  deposits: string[];
  loanNotesList: string[];
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
  /** Original loaned quantity — required for absolute quantity-only returns. */
  quantityLoaned: number;
  /** Gregorian loan/order date (yyyy-MM-dd) used for Hebrew grouping. */
  loanDateIso: string;
  selected: boolean;
  isScannedMatch: boolean;
}

/** Additional quick-return items grouped by loan date (yyyy-MM-dd). */
interface QuickReturnLoanGroup {
  dateKey: string;
  loanDateIso: string;
  hebrewDate: string;
  items: QuickReturnItem[];
}

interface QuickReturnSession {
  scannedCode: string;
  customerName: string;
  phone: string;
  address: string;
  items: QuickReturnItem[];
}

interface DeleteConfirmOrder {
  orders: ActiveLoanOrderRef[];
  cardKey: string;
  customerName: string;
  phone: string;
}

@Component({
  selector: 'app-active-loans',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterLink, ClickOutsideDirective],
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
  private readonly router = inject(Router);
  protected readonly pageTitle = inject(WorkspaceUiService).title('השאלות');

  protected readonly activeLoans = signal<OrderDto[]>([]);
  protected readonly unreturnedReports = signal<UnreturnedItemDto[]>([]);
  protected readonly activeLoading = signal(false);
  protected readonly returningLineKey = signal<string | null>(null);
  protected readonly removingLineKeys = signal<Set<string>>(new Set());
  protected readonly deletingCardKey = signal<string | null>(null);
  protected readonly deleteConfirmOrder = signal<DeleteConfirmOrder | null>(null);

  protected readonly quickReturnTypeId = signal<number | null>(null);
  protected readonly quickReturnCode = signal('');
  protected readonly quickReturnCodeOpen = signal(false);
  protected readonly quickReturnSearching = signal(false);
  protected readonly quickReturnSaving = signal(false);
  protected readonly quickReturnSession = signal<QuickReturnSession | null>(null);
  protected readonly loanSearchQuery = signal('');

  protected readonly activeLoanRows = computed(() => {
    // Reading definitions() here establishes a reactive dependency so the rows
    // recompute (and accessory names resolve correctly) once the store loads.
    this.inventoryStore.definitions();
    return this.buildActiveLoanRows(this.activeLoans());
  });

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
      if (
        (unit.physicalStatus === 'LoanedOut' ||
          unit.physicalStatus === 'Missing' ||
          unit.physicalStatus === 'InRepair') &&
        unit.serialCode.trim()
      ) {
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
    const list = sortNumericCodes([...codes]);
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

    startLiveDataRefresh(
      this.destroyRef,
      () => this.loadActiveLoans(),
      {
        skipWhen: () =>
          this.activeLoading() ||
          this.returningLineKey() != null ||
          this.removingLineKeys().size > 0 ||
          this.deletingCardKey() != null ||
          this.quickReturnSaving() ||
          this.quickReturnSearching() ||
          this.quickReturnSession() != null
      }
    );
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
    return date ? this.hebrew.toHebrewWithDayOfWeek(date) : '';
  }

  /** Compact Hebrew date for a loan row, e.g. "כ״א אייר תשפ״ה". */
  protected itemHebrewDate(iso: string): string {
    if (!iso) {
      return '';
    }
    const date = this.hebrew.parseIso(iso);
    return date ? this.hebrew.toHebrew(date) : iso;
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

  protected isCardDeleting(card: ActiveLoanCustomerCard): boolean {
    return this.deletingCardKey() === card.key;
  }

  protected isCardBusy(card: ActiveLoanCustomerCard): boolean {
    return (
      this.isReturningCustomer(card) ||
      this.isRemovingCustomer(card) ||
      this.isCardDeleting(card) ||
      this.returningLineKey() !== null
    );
  }

  protected cardOrderRefs(card: ActiveLoanCustomerCard): ActiveLoanOrderRef[] {
    const seen = new Set<number>();
    const orders: ActiveLoanOrderRef[] = [];
    for (const order of card.orders) {
      if (order.id <= 0 || seen.has(order.id)) {
        continue;
      }
      seen.add(order.id);
      orders.push(order);
    }
    return orders.sort((a, b) => a.id - b.id);
  }

  protected formatOrderIdList(orderIds: number[]): string {
    return orderIds.map((id) => `#${id}`).join(', ');
  }

  protected startEditCard(card: ActiveLoanCustomerCard): void {
    const orders = this.cardOrderRefs(card);
    if (orders.length === 0) {
      return;
    }
    if (orders.length > 1) {
      this.toast.error('לא ניתן לערוך מספר הזמנות בבת אחת — ערכו כל הזמנה בנפרד');
      return;
    }

    const order = orders[0];
    if (order.isOrderBased) {
      void this.router.navigate(['/orders', order.id]);
      return;
    }
    void this.router.navigate(['/tools/accessory-lending'], {
      queryParams: { edit: order.id }
    });
  }

  protected askDeleteCard(card: ActiveLoanCustomerCard): void {
    const orders = this.cardOrderRefs(card);
    if (orders.length === 0) {
      return;
    }
    this.deleteConfirmOrder.set({
      orders,
      cardKey: card.key,
      customerName: card.customerName,
      phone: card.phone
    });
  }

  protected closeDeleteConfirm(): void {
    if (this.deletingCardKey()) {
      return;
    }
    this.deleteConfirmOrder.set(null);
  }

  protected confirmDeleteOrder(): void {
    const doomed = this.deleteConfirmOrder();
    if (!doomed || this.deletingCardKey()) {
      return;
    }

    this.deletingCardKey.set(doomed.cardKey);
    const requests = doomed.orders.map((order) => this.data.deleteOrder(order.id));
    forkJoin(requests)
      .pipe(finalize(() => this.deletingCardKey.set(null)))
      .subscribe((results) => {
        const okCount = results.filter((ok) => ok).length;
        if (okCount === 0) {
          return;
        }
        const orderIds = doomed.orders.map((o) => o.id);
        this.toast.success(
          doomed.orders.length === 1
            ? doomed.orders[0].isOrderBased
              ? `הזמנה #${orderIds[0]} נמחקה`
              : `השאלה #${orderIds[0]} נמחקה`
            : `${okCount} הזמנות נמחקו (${this.formatOrderIdList(orderIds)})`
        );
        this.deleteConfirmOrder.set(null);
        this.ordersSync.notifyLoanChanged();
        this.loadActiveLoans();
        this.inventoryStore.load({ force: true }).subscribe();
      });
  }

  protected markLineReturned(row: ActiveLoanRow): void {
    if (this.returningLineKey() !== null) {
      return;
    }

    if (row.manualItemId != null && row.manualItemId > 0) {
      this.resolveManualLoanRow(row);
      return;
    }

    if (!row.orderId || row.orderId <= 0 || !row.loanedEquipmentId || row.loanedEquipmentId <= 0) {
      this.toast.warning('לא ניתן לרשום החזרה — נתוני ההשאלה חסרים');
      return;
    }

    const assignedCodes = (row.assignedSerialCodes ?? row.codes ?? [])
      .map((c) => (c ?? '').trim())
      .filter((c) => c.length > 0);
    const hasSerializedLine = assignedCodes.length > 0;
    // Quantity-only returns use absolute ReturnedQuantity on the API — send the
    // full loaned quantity so a prior partial return is not overwritten downward.
    const quantityReturned = hasSerializedLine
      ? assignedCodes.length
      : Math.max(row.quantityLoaned || row.quantity || 0, 1);

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
    if (this.returningLineKey() !== null || (card.items?.length ?? 0) === 0) {
      return;
    }

    type LineReturn = {
      loanedEquipmentId: number;
      serialCodes: string[];
      quantityOnly: number;
    };
    const byOrder = new Map<number, LineReturn[]>();
    const manualIds: number[] = [];

    for (const row of card.items ?? []) {
      if (row.manualItemId != null && row.manualItemId > 0) {
        manualIds.push(row.manualItemId);
        continue;
      }

      if (!row.orderId || row.orderId <= 0 || !row.loanedEquipmentId || row.loanedEquipmentId <= 0) {
        continue;
      }

      const list = byOrder.get(row.orderId) ?? [];
      const assignedCodes = (row.assignedSerialCodes ?? row.codes ?? [])
        .map((c) => (c ?? '').trim())
        .filter((c) => c.length > 0);
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
          quantityOnly: Math.max(row.quantityLoaned || row.quantity || 0, 1)
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

  protected closeQuickReturnCodePanel(): void {
    this.quickReturnCodeOpen.set(false);
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
      // Only offer other outstanding lines from the same order/transaction (#ID).
      const customerRows = this.activeLoanRows().filter(
        (row) => !row.isOneTimeItem && row.orderId > 0 && row.orderId === match.orderId
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

  /** Additional (non-scanned) items grouped by loan date. */
  protected quickReturnAdditionalGroups(session: QuickReturnSession): QuickReturnLoanGroup[] {
    const extras = session.items.filter((item) => !item.isScannedMatch);
    const byDate = new Map<string, QuickReturnLoanGroup>();

    for (const item of extras) {
      const dateKey = item.loanDateIso || '';
      let group = byDate.get(dateKey);
      if (!group) {
        const hebrewDate = this.activeLoanHebrewDate(item.loanDateIso);
        group = {
          dateKey,
          loanDateIso: item.loanDateIso,
          hebrewDate: hebrewDate || 'ללא תאריך',
          items: []
        };
        byDate.set(dateKey, group);
      }
      group.items.push(item);
    }

    return [...byDate.values()].sort((a, b) =>
      (b.loanDateIso || '').localeCompare(a.loanDateIso || '')
    );
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

  /** Select (or clear) every additional item in a date group. */
  protected selectQuickReturnGroup(dateKey: string, selected = true): void {
    this.quickReturnSession.update((session) => {
      if (!session) {
        return session;
      }
      return {
        ...session,
        items: session.items.map((item) => {
          if (item.isScannedMatch || (item.loanDateIso || '') !== dateKey) {
            return item;
          }
          return { ...item, selected };
        })
      };
    });
  }

  protected isQuickReturnGroupFullySelected(group: QuickReturnLoanGroup): boolean {
    return group.items.length > 0 && group.items.every((item) => item.selected);
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
        // Absolute ReturnedQuantity API — send full loaned qty, not remaining.
        entry.quantityOnly = Math.max(item.quantityLoaned || item.quantity || 1, entry.quantityOnly);
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

    const terms = query.split(/\s+/).filter((t) => t.length > 0);
    const filtered = cards.filter((card) => {
      const itemNames = card.items.map((item) => item.accessoryName);
      const customerName = (card.customerName ?? '').toLowerCase();
      const address = (card.address ?? '').toLowerCase();
      const phoneRaw = (card.phone ?? '').toLowerCase();
      const phoneDigits = this.normalizePhone(card.phone);
      const orderIds = card.orders.map((o) => String(o.id));
      const itemNamesLower = card.items.map((item) => (item.accessoryName ?? '').toLowerCase());
      const assignedCodes = card.items.flatMap((item) =>
        (item.assignedSerialCodes ?? []).map((c) => c.toLowerCase())
      );
      const itemCodes = card.items.flatMap((item) => (item.codes ?? []).map((c) => c.toLowerCase()));

      // Full phrase search is strict contiguous match in the two primary textual fields.
      const phraseMatch = customerName.includes(query) || itemNamesLower.some((name) => name.includes(query));

      if (phraseMatch) {
        return true;
      }

      // AND across terms, OR across fields per term.
      return terms.every((term) => {
        const digitsTerm = term.replace(/\D/g, '');
        const termMatches =
          customerName.includes(term) ||
          address.includes(term) ||
          phoneRaw.includes(term) ||
          (digitsTerm.length > 0 && phoneDigits.includes(digitsTerm)) ||
          orderIds.some((id) => id.includes(term) || (digitsTerm.length > 0 && id.includes(digitsTerm))) ||
          itemNamesLower.some((name) => name.includes(term)) ||
          assignedCodes.some((c) => c.includes(term)) ||
          itemCodes.some((c) => c.includes(term));

        return termMatches;
      });
    });
    return filtered;
  }

  private customerCardKey(row: Pick<ActiveLoanRow, 'customerName' | 'phone'>): string {
    return `${row.customerName.trim()}|${this.normalizePhone(row.phone)}`;
  }

  private customerDayCardKey(row: Pick<ActiveLoanRow, 'customerName' | 'phone' | 'loanDateIso'>): string {
    return `${this.customerCardKey(row)}|${(row.loanDateIso ?? '').trim()}`;
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
      // One card per order/transaction so returns and edits never cross #IDs.
      const key =
        row.orderId > 0 ? `order:${row.orderId}` : this.customerDayCardKey(row);
      let card = byCustomer.get(key);
      if (!card) {
        card = {
          key,
          customerName: row.customerName,
          phone: row.phone,
          address: row.address,
          loanDateIso: row.loanDateIso,
          customerNotes: this.customers.notesForPhone(row.phone),
          deposits: [],
          loanNotesList: [],
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
      if (row.deposit && !card.deposits.includes(row.deposit)) {
        card.deposits.push(row.deposit);
      }
      if (row.loanNotes && !card.loanNotesList.includes(row.loanNotes)) {
        card.loanNotesList.push(row.loanNotes);
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
        quantityLoaned: report.missingQuantity > 0 ? report.missingQuantity : 1,
        codes,
        loanDateIso: report.returnDate,
        isCustomItem: report.isCustomItem || !report.inventoryDefinitionId,
        isOneTimeItem:
          report.manualItemId != null && report.manualItemId > 0
            ? !report.inventoryDefinitionId
            : this.isOneTimeAccessoryName(accessoryName, report.isCustomItem),
        assignedSerialCodes: codes,
        isOrderBased: report.orderId > 0,
        deposit: null,
        loanNotes: null,
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

      const key = this.customerDayCardKey(reportRow);
      byCustomer.set(key, {
        key,
        customerName: reportRow.customerName,
        phone: reportRow.phone,
        address: reportRow.address,
        loanDateIso: reportRow.loanDateIso,
        customerNotes: this.customers.notesForPhone(reportRow.phone),
        deposits: [],
        loanNotesList: [],
        orders:
          reportRow.orderId > 0 ? [{ id: reportRow.orderId, isOrderBased: true }] : [],
        items: [reportRow],
        totalQuantity: reportRow.quantity
      });
    }

    const cards = [...byCustomer.values()];
    for (const card of cards) {
      this.sortActiveLoanItems(card.items);
      card.loanDateIso = card.items[0]?.loanDateIso ?? card.loanDateIso;
    }
    return cards.sort((a, b) => {
      const nameCmp = a.customerName.localeCompare(b.customerName, 'he');
      if (nameCmp !== 0) {
        return nameCmp;
      }
      const dateCmp = (b.loanDateIso || '').localeCompare(a.loanDateIso || '');
      return dateCmp !== 0 ? dateCmp : a.phone.localeCompare(b.phone, 'he');
    });
  }

  private sortActiveLoanItems(items: ActiveLoanRow[]): void {
    items.sort((a, b) => {
      const dateCmp = (b.loanDateIso || '').localeCompare(a.loanDateIso || '');
      if (dateCmp !== 0) {
        return dateCmp;
      }
      if (b.orderId !== a.orderId) {
        return b.orderId - a.orderId;
      }
      return a.accessoryName.localeCompare(b.accessoryName, 'he');
    });
  }

  private findCustomerCardKeyForReport(
    report: UnreturnedItemDto,
    cards: Map<string, ActiveLoanCustomerCard>
  ): string | null {
    const reportDate = (report.returnDate ?? '').trim();
    const phone = this.normalizePhone(report.phone);
    if (phone.length >= 7) {
      for (const [key, card] of cards) {
        if (this.normalizePhone(card.phone) === phone && (!reportDate || card.loanDateIso === reportDate)) {
          return key;
        }
      }
      for (const [key, card] of cards) {
        if (this.normalizePhone(card.phone) === phone) {
          return key;
        }
      }
    }

    const name = (report.customerName ?? '').trim().toLowerCase();
    if (name.length > 0) {
      for (const [key, card] of cards) {
        if (
          card.customerName.trim().toLowerCase() === name &&
          (!reportDate || card.loanDateIso === reportDate)
        ) {
          return key;
        }
      }
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
            quantityLoaned: row.quantityLoaned || row.quantity || 1,
            loanDateIso: row.loanDateIso,
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
        quantityLoaned: row.quantityLoaned || row.quantity || 1,
        loanDateIso: row.loanDateIso,
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
    for (const type of LOANED_EQUIPMENT_ORDER) {
      const linkedLabel = LOANED_EQUIPMENT_LABELS[type];
      if (
        def.displayName.trim().localeCompare(linkedLabel, 'he', { sensitivity: 'accent' }) === 0 &&
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
      const deposit = this.formatOrderDeposit(order);
      const loanNotes = (order.notes ?? '').trim() || null;
      for (const le of order.loanedEquipments ?? []) {
        if (le.id == null || le.id <= 0 || le.quantity <= 0) {
          continue;
        }
        const returned = le.returnedQuantity ?? 0;
        if (returned >= le.quantity) {
          continue;
        }
        const codes = sortNumericCodes(
          (le.notes ?? [])
            .filter((n) => !n.isReturned)
            .map((n) => (n.content ?? '').trim())
            .filter((c) => c.length > 0)
        );
        const allCodesForLabel = sortNumericCodes(
          (le.notes ?? [])
            .map((n) => (n.content ?? '').trim())
            .filter((c) => c.length > 0)
        );
        const accessoryName = (() => {
          const fromLine = this.inventoryStore.displayLabelForLoanedLine(le);
          if (!this.inventoryStore.isPlaceholderItemName(fromLine)) {
            return fromLine;
          }
          return (
            this.inventoryStore.definitionForSerialCodes(codes)?.displayName?.trim() ||
            this.inventoryStore.definitionForSerialCodes(allCodesForLabel)?.displayName?.trim() ||
            fromLine
          );
        })();
        rows.push({
          key: `${order.id}-${le.id}`,
          orderId: order.id,
          loanedEquipmentId: le.id,
          customerName: order.customerName?.trim() || 'ללא שם',
          phone: order.phone,
          address: order.address?.trim() || '',
          accessoryName,
          quantity: le.quantity - returned,
          quantityLoaned: le.quantity,
          codes,
          loanDateIso,
          isCustomItem: !!le.isCustomItem,
          isOneTimeItem: this.isOneTimeAccessoryName(accessoryName, !!le.isCustomItem),
          assignedSerialCodes: codes,
          isOrderBased,
          deposit,
          loanNotes
        });
      }
    }
    return rows;
  }

  private formatOrderDeposit(order: OrderDto): string | null {
    const typeLabel =
      order.depositType != null
        ? DEPOSIT_TYPE_LABELS[order.depositType as DepositType] ?? null
        : null;
    const onName = (order.depositOnName ?? '').trim() || null;
    if (!typeLabel && !onName) {
      return null;
    }
    if (!typeLabel) {
      return onName;
    }
    return onName ? `${typeLabel} — ${onName}` : typeLabel;
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
          this.unreturnedReports.set(
            unreturned.map((row) => this.inventoryStore.enrichUnreturnedItem(row))
          );
        },
        error: () => {
          this.activeLoans.set([]);
          this.unreturnedReports.set([]);
        }
      });
  }
}
