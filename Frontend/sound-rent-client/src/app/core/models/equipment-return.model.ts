import { LoanedEquipmentType } from './enums';

export interface OrderReturnItemDto {
  loanedEquipmentType: LoanedEquipmentType;
  quantityReturned: number;
}

export interface OrderCustomMissingItemInputDto {
  /** Set only when updating an existing pending custom item. */
  id?: number | null;
  itemName: string;
  missingQuantity: number;
}

export interface OrderCustomMissingItemDto {
  id: number;
  itemName: string;
  missingQuantity: number;
  isResolved: boolean;
}

export interface OrderReturnRequestDto {
  items: OrderReturnItemDto[];
  customMissingItems: OrderCustomMissingItemInputDto[];
}

export interface UnreturnedItemDto {
  orderId: number;
  customerName?: string | null;
  phone: string;
  isCustomItem: boolean;
  customMissingItemId?: number | null;
  loanedEquipmentType?: LoanedEquipmentType | null;
  equipmentName: string;
  returnDate: string; // ISO yyyy-MM-dd
  quantityLoaned: number;
  missingQuantity: number;
}
