import { SystemType } from './enums';

export interface EquipmentDefinitionDto {
  id: string;
  displayName: string;
  category: string;
  sortOrder: number;
  /** True when this booking slot is marked unavailable for new orders (per-unit maintenance). */
  isUnderMaintenance?: boolean;
  systemType?: SystemType;
}

export interface EquipmentDefinitionAvailabilityDto extends EquipmentDefinitionDto {
  isOccupied: boolean;
}

export interface EquipmentAvailabilityRequest {
  shifts: { orderDate: string; timeSlot: string }[];
  excludeOrderId?: number;
  systemType?: SystemType;
}

export interface EquipmentDefinitionCreateDto {
  id: string;
  displayName: string;
  category: string;
  sortOrder: number;
  systemType?: SystemType;
}

/** Creates one definition row per item code (each code becomes the definition id). */
export interface EquipmentDefinitionBatchCreateDto {
  displayName: string;
  category: string;
  itemCodes: string[];
  systemType?: SystemType;
}

export interface EquipmentDefinitionUpdateDto {
  displayName: string;
  sortOrder: number;
}

/** Payload from DELETE equipment-definition 400 when future/today orders block deletion */
export interface EquipmentDefinitionDeleteFutureOrder {
  orderId: number;
  customerName: string | null;
  orderDate: string;
}
