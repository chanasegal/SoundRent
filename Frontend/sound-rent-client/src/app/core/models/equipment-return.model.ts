import { LoanedEquipmentType } from './enums';

export interface OrderReturnItemDto {
  loanedEquipmentId: number;
  quantityReturned: number;
  returnedSerialCodes?: string[];
}

export interface OrderReturnRequestDto {
  items: OrderReturnItemDto[];
}

export interface UndoOrderReturnRequestDto {
  loanedEquipmentId: number;
  /** Specific serial to un-return; omit for quantity-only lines. */
  serialCode?: string | null;
  /** Units to undo on a quantity-only line; omit to undo the full returned quantity. */
  quantity?: number | null;
}

export interface DeleteReturnedAccessoryRequestDto {
  loanedEquipmentId: number;
  /** Specific returned serial to erase; omit for quantity-only lines. */
  serialCode?: string | null;
  /** Units to erase on a quantity-only line; omit to erase the full returned quantity. */
  quantity?: number | null;
}

export interface MarkUnreturnedItemDto {
  loanedEquipmentId: number;
  missingQuantity: number;
  missingSerialCodes?: string[];
}

export interface MarkUnreturnedRequestDto {
  items: MarkUnreturnedItemDto[];
}

export interface UnreturnedItemDto {
  /** When set, this row is a standalone manual entry (no order line). */
  manualItemId?: number | null;
  /** Catalog row id when the manual entry is tied to inventory. */
  inventoryDefinitionId?: number | null;
  orderId: number;
  customerName?: string | null;
  phone: string;
  address?: string | null;
  loanedEquipmentId: number;
  isCustomItem: boolean;
  loanedEquipmentType?: LoanedEquipmentType | null;
  equipmentName: string;
  returnDate: string; // ISO yyyy-MM-dd
  quantityLoaned: number;
  missingQuantity: number;
  missingSerialCodes: string[];
  assignedSerialCodes: string[];
}

export interface CreateManualUnreturnedItemDto {
  orderId?: number | null;
  customerName?: string | null;
  phone?: string | null;
  address?: string | null;
  inventoryDefinitionId?: number | null;
  loanedEquipmentType?: LoanedEquipmentType | null;
  itemName?: string | null;
  itemCode?: string | null;
}

/** Active free-text (one-time) accessory loan with no inventory catalog row. */
export interface ActiveOneTimeAccessoryLoanDto {
  orderId: number;
  loanedEquipmentId: number;
  /** Set when the row comes from a manual unreturned report (no order line). */
  manualItemId?: number | null;
  itemName: string;
  quantity: number;
  outstandingQuantity: number;
  customerName?: string | null;
  phone: string;
  address?: string | null;
  /** yyyy-MM-dd */
  loanDate?: string | null;
  serialCodes: string[];
}

/** Flattened history row for a returned Sound accessory (serial or quantity-only). */
export interface ReturnedAccessoryHistoryDto {
  orderId: number;
  loanedEquipmentId: number;
  itemName: string;
  /** Assigned serial when the return was tracked per code; otherwise null. */
  serialCode?: string | null;
  quantity: number;
  customerName?: string | null;
  phone: string;
  address?: string | null;
  /** yyyy-MM-dd — earliest order shift date. */
  loanDate?: string | null;
  /** yyyy-MM-dd — best-available return/event date. */
  returnDate?: string | null;
  isCustomItem: boolean;
  /** True when the loan is tied to weekly-schedule main equipment. */
  isOrderBased: boolean;
}
