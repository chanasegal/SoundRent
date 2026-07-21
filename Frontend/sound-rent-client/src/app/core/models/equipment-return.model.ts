import { LoanedEquipmentType } from './enums';

export interface OrderReturnItemDto {
  loanedEquipmentId: number;
  quantityReturned: number;
  returnedSerialCodes?: string[];
}

export interface OrderReturnRequestDto {
  items: OrderReturnItemDto[];
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
  /** When set, this row is a standalone manual entry (no order). */
  manualItemId?: number | null;
  /** Catalog row id when the manual entry is tied to inventory. */
  inventoryDefinitionId?: number | null;
  orderId: number;
  customerName?: string | null;
  phone: string;
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
