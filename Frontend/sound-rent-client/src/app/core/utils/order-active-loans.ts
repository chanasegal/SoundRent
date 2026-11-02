import { OrderDto, OrderLoanedEquipmentDto } from '../models/order.model';

/** Non-empty serial codes currently assigned on a loaned line (actual units taken). */
export function assignedSerialCodesOnLine(
  line: Pick<OrderLoanedEquipmentDto, 'notes'>
): string[] {
  return (line.notes ?? [])
    .map((n) => (n.content ?? '').trim())
    .filter((c) => c.length > 0);
}

/**
 * Actual quantity taken/issued from the warehouse.
 * Serialized lines: count of assigned codes. Quantity-only lines: ordered `quantity`.
 * Ordered quantity may be higher than issued when not all codes were entered yet.
 */
export function issuedQuantity(line: Pick<OrderLoanedEquipmentDto, 'quantity' | 'notes'>): number {
  const assigned = assignedSerialCodesOnLine(line);
  if (assigned.length > 0) {
    return assigned.length;
  }
  return Math.max(line.quantity, 0);
}

/** Units still out — based on issued quantity, not the original ordered quantity. */
export function outstandingQuantity(
  line: Pick<OrderLoanedEquipmentDto, 'quantity' | 'returnedQuantity' | 'notes'>
): number {
  const assignedNotes = (line.notes ?? []).filter((n) => (n.content ?? '').trim().length > 0);
  if (assignedNotes.length > 0) {
    return assignedNotes.filter((n) => n.isReturned !== true).length;
  }
  return Math.max(0, line.quantity - (line.returnedQuantity ?? 0));
}

/**
 * Mirrors the server rule (OrderService.IsLoanedEquipmentActiveForReturnState):
 * a line is still out when issued units have not all come back.
 * Incomplete code entry vs ordered quantity does not keep the line active.
 */
export function isLoanedLineActive(line: OrderLoanedEquipmentDto): boolean {
  if (line.quantity <= 0) {
    return false;
  }
  return outstandingQuantity(line) > 0;
}

/** Lines saved in the same request as the order share its timestamp; allow for rounding. */
const SAME_SAVE_TOLERANCE_MS = 1000;

/**
 * The line's own timestamp when it was added by a later edit of the order;
 * null when it belongs to the original order (or has no per-line timestamp).
 */
export function loanedLineAddedLaterAt(
  line: Pick<OrderLoanedEquipmentDto, 'addedAt'>,
  order: Pick<OrderDto, 'createdAt'>
): Date | null {
  const added = line.addedAt ? new Date(line.addedAt) : null;
  const created = new Date(order.createdAt);
  if (!added || Number.isNaN(added.getTime()) || Number.isNaN(created.getTime())) {
    return null;
  }
  return added.getTime() - created.getTime() > SAME_SAVE_TOLERANCE_MS ? added : null;
}

export function orderHasActiveLoans(order: OrderDto | null | undefined): boolean {
  return (order?.loanedEquipments ?? []).some(isLoanedLineActive);
}

/**
 * True when any return was logged for this order (full or partial) —
 * either the order is marked return-processed, or a line has returnedQuantity / returned notes.
 */
export function orderHasRecordedReturns(order: OrderDto | null | undefined): boolean {
  if (!order) {
    return false;
  }
  if (order.isReturnProcessed) {
    return true;
  }
  return (order.loanedEquipments ?? []).some(
    (le) =>
      (le.returnedQuantity ?? 0) > 0 ||
      (le.notes ?? []).some((n) => n.isReturned === true)
  );
}

/**
 * Ended-order case: accessories are still out and no return registration exists at all
 * (distinct from partial returns, which already have recorded returns).
 */
export function orderHasNeverRecordedReturns(order: OrderDto | null | undefined): boolean {
  return orderHasActiveLoans(order) && !orderHasRecordedReturns(order);
}

export function buildOrderDeleteConfirmMessage(
  order: OrderDto | null | undefined,
  orderNumber: string,
  standardMessage: string
): string {
  return orderHasActiveLoans(order)
    ? `שים לב, הזמנה ${orderNumber} מכילה השאלה פעילה. האם אתה בטוח שברצונך למחוק?`
    : standardMessage;
}
