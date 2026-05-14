export interface EquipmentDefinitionDto {
  id: string;
  displayName: string;
  category: string;
  sortOrder: number;
  /** True when this booking slot is marked unavailable for new orders (per-unit maintenance). */
  isUnderMaintenance?: boolean;
}
export interface EquipmentDefinitionCreateDto {
  id: string;
  displayName: string;
  category: string;
  sortOrder: number;
}

/** Payload from DELETE equipment-definition 400 when future/today orders block deletion */
export interface EquipmentDefinitionDeleteFutureOrder {
  orderId: number;
  customerName: string | null;
  orderDate: string;
}
