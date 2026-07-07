import { LoanedEquipmentType } from './enums';

export interface OrderReturnItemDto {
  loanedEquipmentId: number;
  quantityReturned: number;
}

export interface OrderReturnRequestDto {
  items: OrderReturnItemDto[];
}

export interface UnreturnedItemDto {
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
}
