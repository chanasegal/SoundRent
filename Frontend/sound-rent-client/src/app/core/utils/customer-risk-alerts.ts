import { UnreturnedItemDto } from '../models/equipment-return.model';
import { OpenDebtGroupDto } from '../models/open-debt.model';
import { OrderDto } from '../models/order.model';

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
  unreturnedItems: UnreturnedItemDto[];
  cancelledDebtMessage: string;
  openDebtMessage: string;
  unreturnedMessage: string;
}

export function buildCustomerRiskAlertSnapshot(
  cancelledOrders: OrderDto[],
  openDebts: OpenDebtGroupDto[],
  unreturned: UnreturnedItemDto[],
  phoneDigits: string,
  customerName: string
): CustomerRiskAlertSnapshot {
  const cancelledDebtAmount = sumCancelledOrderDebt(cancelledOrders, phoneDigits, customerName);
  const openDebtAmount = sumOpenDebt(openDebts, phoneDigits, customerName);
  const unreturnedItems = filterUnreturnedForCustomer(unreturned, phoneDigits, customerName);
  return {
    cancelledDebtAmount,
    openDebtAmount,
    unreturnedItems,
    cancelledDebtMessage: buildCancelledDebtAlertMessage(cancelledDebtAmount),
    openDebtMessage: buildOpenDebtAlertMessage(openDebtAmount),
    unreturnedMessage: buildUnreturnedItemsAlertMessage(unreturnedItems)
  };
}

export const EMPTY_CUSTOMER_RISK_ALERTS: CustomerRiskAlertSnapshot = {
  cancelledDebtAmount: 0,
  openDebtAmount: 0,
  unreturnedItems: [],
  cancelledDebtMessage: '',
  openDebtMessage: '',
  unreturnedMessage: ''
};
