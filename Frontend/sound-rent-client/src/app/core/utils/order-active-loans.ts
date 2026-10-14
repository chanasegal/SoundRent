import { OrderDto, OrderLoanedEquipmentDto } from '../models/order.model';

/**
 * Mirrors the server rule (OrderService.IsLoanedEquipmentActiveForReturnState):
 * a line is still out when not all units came back, or an assigned serial is not marked returned.
 */
export function isLoanedLineActive(line: OrderLoanedEquipmentDto): boolean {
  if (line.quantity <= 0) {
    return false;
  }
  if ((line.returnedQuantity ?? 0) < line.quantity) {
    return true;
  }
  return (line.notes ?? []).some(
    (n) => n.isReturned !== true && (n.content ?? '').trim().length > 0
  );
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

export function buildOrderDeleteConfirmMessage(
  order: OrderDto | null | undefined,
  orderNumber: string,
  standardMessage: string
): string {
  return orderHasActiveLoans(order)
    ? `שים לב, הזמנה ${orderNumber} מכילה השאלה פעילה. האם אתה בטוח שברצונך למחוק?`
    : standardMessage;
}
