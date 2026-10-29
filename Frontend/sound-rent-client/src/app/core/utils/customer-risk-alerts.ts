import { CashDepositDto } from '../models/cash-deposit.model';
import { UnreturnedItemDto } from '../models/equipment-return.model';
import {
  LOST_EQUIPMENT_ACTIVE_STATUSES,
  LostEquipmentDto
} from '../models/lost-equipment.model';
import { OpenDebtGroupDto } from '../models/open-debt.model';
import { OrderDto } from '../models/order.model';
import {
  buildOpenCashDepositAlertMessage,
  sumOpenCashDepositAmount
} from './cash-deposit';
import { orderHasNeverRecordedReturns } from './order-active-loans';

/** Digits-only phone normalize used for customer matching. */
export function digitsOnlyPhone(raw: string | null | undefined): string {
  return String(raw ?? '').replace(/\D/g, '');
}

/**
 * Match a customer row by phone (preferred) or exact name fallback —
 * same rules as the forgotten-equipment alert on the order form.
 */
export function matchesCustomerIdentity(
  rowPhone: string | null | undefined,
  rowName: string | null | undefined,
  phoneDigits: string,
  customerName: string
): boolean {
  const rowPhoneDigits = digitsOnlyPhone(rowPhone);
  if (phoneDigits.length >= 7 && rowPhoneDigits.length > 0 && rowPhoneDigits === phoneDigits) {
    return true;
  }
  const name = customerName.trim();
  const row = (rowName ?? '').trim();
  if (name.length >= 2 && row === name) {
    if (rowPhoneDigits.length === 0 || phoneDigits.length < 7) {
      return true;
    }
  }
  return false;
}

export function sumCancelledOrderDebt(
  orders: OrderDto[],
  phoneDigits: string,
  customerName: string
): number {
  return orders
    .filter(
      (o) =>
        o.isCancelled &&
        (o.paymentAmount ?? 0) > 0 &&
        matchesCustomerIdentity(o.phone, o.customerName, phoneDigits, customerName)
    )
    .reduce((sum, o) => sum + Number(o.paymentAmount ?? 0), 0);
}

export function sumOpenDebt(
  groups: OpenDebtGroupDto[],
  phoneDigits: string,
  customerName: string
): number {
  return groups
    .filter(
      (g) =>
        (g.totalAmount ?? 0) > 0 &&
        matchesCustomerIdentity(g.phone, g.customerName, phoneDigits, customerName)
    )
    .reduce((sum, g) => sum + Number(g.totalAmount ?? 0), 0);
}

export function filterUnreturnedForCustomer(
  items: UnreturnedItemDto[],
  phoneDigits: string,
  customerName: string
): UnreturnedItemDto[] {
  return items.filter((row) =>
    matchesCustomerIdentity(row.phone, row.customerName, phoneDigits, customerName)
  );
}

/** Format shekel amount for alert copy (e.g. "1,250"). */
export function formatAlertShekels(amount: number): string {
  return new Intl.NumberFormat('he-IL', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  }).format(amount);
}

export function formatUnreturnedItemLabel(row: UnreturnedItemDto): string {
  const name = (row.equipmentName ?? '').trim() || 'פריט';
  const codes = (row.missingSerialCodes ?? [])
    .map((c) => String(c ?? '').trim())
    .filter((c) => c.length > 0);
  if (codes.length === 0) {
    return name;
  }
  return `${name} (${codes.join(', ')})`;
}

/**
 * Build the unreturned-items warning line.
 * Singular/plural verb adjusts to the number of matching rows.
 */
export function buildUnreturnedItemsAlertMessage(items: UnreturnedItemDto[]): string {
  if (items.length === 0) {
    return '';
  }
  const labels = items.map(formatUnreturnedItemLabel);
  const verb = items.length === 1 ? 'שלא הוחזר' : 'שלא הוחזרו';
  return `שים לב ללקוח זה יש ${labels.join(', ')} ${verb}`;
}

export function buildCancelledDebtAlertMessage(amount: number): string {
  if (amount <= 0) {
    return '';
  }
  return `שים לב ללקוח זה יש חוב מהזמנה מבוטלת על סך ${formatAlertShekels(amount)} שקלים`;
}

export function buildOpenDebtAlertMessage(amount: number): string {
  if (amount <= 0) {
    return '';
  }
  return `שים לב ללקוח זה יש חוב פתוח על סך ${formatAlertShekels(amount)} שקלים`;
}

export interface CustomerRiskAlertSnapshot {
  cancelledDebtAmount: number;
  openDebtAmount: number;
  openCashDepositAmount: number;
  unreturnedItems: UnreturnedItemDto[];
  cancelledDebtMessage: string;
  openDebtMessage: string;
  openCashDepositMessage: string;
  unreturnedMessage: string;
}

export function filterOpenCashDepositsForCustomer(
  deposits: CashDepositDto[],
  phoneDigits: string,
  customerName: string
): CashDepositDto[] {
  return deposits.filter((d) =>
    matchesCustomerIdentity(d.phone, d.customerName, phoneDigits, customerName)
  );
}

export function buildCustomerRiskAlertSnapshot(
  cancelledOrders: OrderDto[],
  openDebts: OpenDebtGroupDto[],
  unreturned: UnreturnedItemDto[],
  phoneDigits: string,
  customerName: string,
  openCashDeposits: CashDepositDto[] = []
): CustomerRiskAlertSnapshot {
  const cancelledDebtAmount = sumCancelledOrderDebt(cancelledOrders, phoneDigits, customerName);
  const openDebtAmount = sumOpenDebt(openDebts, phoneDigits, customerName);
  const unreturnedItems = filterUnreturnedForCustomer(unreturned, phoneDigits, customerName);
  const openCashDepositAmount = sumOpenCashDepositAmount(
    filterOpenCashDepositsForCustomer(openCashDeposits, phoneDigits, customerName)
  );
  return {
    cancelledDebtAmount,
    openDebtAmount,
    openCashDepositAmount,
    unreturnedItems,
    cancelledDebtMessage: buildCancelledDebtAlertMessage(cancelledDebtAmount),
    openDebtMessage: buildOpenDebtAlertMessage(openDebtAmount),
    openCashDepositMessage: buildOpenCashDepositAlertMessage(openCashDepositAmount),
    unreturnedMessage: buildUnreturnedItemsAlertMessage(unreturnedItems)
  };
}

export const EMPTY_CUSTOMER_RISK_ALERTS: CustomerRiskAlertSnapshot = {
  cancelledDebtAmount: 0,
  openDebtAmount: 0,
  openCashDepositAmount: 0,
  unreturnedItems: [],
  cancelledDebtMessage: '',
  openDebtMessage: '',
  openCashDepositMessage: '',
  unreturnedMessage: ''
};

export const CANCELLED_ORDER_STATUS_TOOLTIP = 'ישנה הזמנה מבוטלת';

/** True when the customer has any cancelled order (with or without debt). */
export function customerHasCancelledOrder(
  cancelledOrders: OrderDto[],
  phoneDigits: string,
  customerName: string
): boolean {
  return cancelledOrders.some(
    (o) =>
      o.isCancelled && matchesCustomerIdentity(o.phone, o.customerName, phoneDigits, customerName)
  );
}

export function filterActiveLostForCustomer(
  items: LostEquipmentDto[],
  phoneDigits: string,
  customerName: string
): LostEquipmentDto[] {
  return items.filter(
    (row) =>
      LOST_EQUIPMENT_ACTIVE_STATUSES.has(row.status) &&
      matchesCustomerIdentity(row.phone, row.customerName, phoneDigits, customerName)
  );
}

export function formatLostEquipmentItemLabel(row: LostEquipmentDto): string {
  const desc = (row.itemDescription ?? '').trim() || 'פריט';
  const parts = [desc];
  const date = (row.hebrewDate ?? '').trim();
  if (date) {
    parts.push(date);
  }
  const notes = (row.notes ?? '').trim();
  if (notes) {
    parts.push(notes);
  }
  return parts.join(' · ');
}

/** Hover copy for forgotten-equipment badges on search cards. */
export function buildForgottenEquipmentTooltip(items: LostEquipmentDto[]): string {
  if (items.length === 0) {
    return '';
  }
  return `ציוד שנשכח: ${items.map(formatLostEquipmentItemLabel).join(' | ')}`;
}

export const NEVER_RETURNED_EQUIPMENT_TOOLTIP =
  'ציוד טרם הוחזר — לא בוצעה רישום החזרה להזמנה זו';

export interface ClientSearchStatusTooltips {
  /** Red debt badge hover text; null when no outstanding debt. */
  openDebtTooltip: string | null;
  /** Yellow missing-equipment badge hover text; null when nothing is missing. */
  missingEquipmentTooltip: string | null;
  /**
   * Zero return logs while accessories are still out (not partial returns).
   * Shown on ended search cards as "ציוד טרם הוחזר".
   */
  neverReturnedTooltip: string | null;
  /** Forgotten-equipment badge hover text; null when none apply. */
  forgottenEquipmentTooltip: string | null;
  /** Cross-order cancelled cue on active cards ("ישנה הזמנה מבוטלת"); null when none. */
  cancelledTooltip: string | null;
  /** Open cash-deposit badge hover text with exact amount; null when none. */
  openCashDepositTooltip: string | null;
}

/**
 * Status indicators for a weekly-board client-search card.
 * Combines order-level flags with customer-level debt / unreturned / cancelled / cash-deposit data.
 */
export function buildClientSearchStatusTooltips(
  cancelledOrders: OrderDto[],
  openDebts: OpenDebtGroupDto[],
  unreturned: UnreturnedItemDto[],
  order: OrderDto,
  lostEquipment: LostEquipmentDto[] = [],
  openCashDeposits: CashDepositDto[] = []
): ClientSearchStatusTooltips {
  const phoneDigits = digitsOnlyPhone(order.phone);
  const customerName = (order.customerName ?? '').trim();
  const snapshot = buildCustomerRiskAlertSnapshot(
    cancelledOrders,
    openDebts,
    unreturned,
    phoneDigits,
    customerName,
    openCashDeposits
  );

  const debtParts: string[] = [];
  if (snapshot.openDebtAmount > 0 && snapshot.openDebtMessage) {
    debtParts.push(snapshot.openDebtMessage);
  }
  if (snapshot.cancelledDebtAmount > 0 && snapshot.cancelledDebtMessage) {
    debtParts.push(snapshot.cancelledDebtMessage);
  }
  if (debtParts.length === 0 && order.isUnpaid) {
    const amount = Number(order.paymentAmount ?? 0);
    debtParts.push(
      amount > 0
        ? buildOpenDebtAlertMessage(amount)
        : 'שים לב ללקוח זה יש חוב פתוח להזמנה זו'
    );
  }

  const orderUnreturned = unreturned.filter((row) => row.orderId === order.id);
  const missingItems =
    orderUnreturned.length > 0 ? orderUnreturned : snapshot.unreturnedItems;
  const forgottenItems = filterActiveLostForCustomer(lostEquipment, phoneDigits, customerName);

  // Cross-order cue only: the cancelled card itself uses a status badge, not this warning.
  const hasRelatedCancelled =
    !order.isCancelled && customerHasCancelledOrder(cancelledOrders, phoneDigits, customerName);

  return {
    openDebtTooltip: debtParts.length > 0 ? debtParts.join(' · ') : null,
    missingEquipmentTooltip:
      missingItems.length > 0 ? buildUnreturnedItemsAlertMessage(missingItems) : null,
    neverReturnedTooltip: orderHasNeverRecordedReturns(order)
      ? NEVER_RETURNED_EQUIPMENT_TOOLTIP
      : null,
    forgottenEquipmentTooltip:
      forgottenItems.length > 0 ? buildForgottenEquipmentTooltip(forgottenItems) : null,
    cancelledTooltip: hasRelatedCancelled ? CANCELLED_ORDER_STATUS_TOOLTIP : null,
    openCashDepositTooltip:
      snapshot.openCashDepositAmount > 0 && snapshot.openCashDepositMessage
        ? snapshot.openCashDepositMessage
        : null
  };
}
