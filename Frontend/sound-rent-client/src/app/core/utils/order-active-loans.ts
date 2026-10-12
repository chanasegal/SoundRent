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
