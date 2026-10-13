import { LoanedEquipmentType } from './enums';
import { InventorySerialPhysicalStatus } from './inventory-definition.model';

export interface EquipmentDefaultAccessoryDto {
  id: number;
  parentEquipmentType: LoanedEquipmentType;
  parentSerialCode: string;
  parentLabel: string;
  inventoryDefinitionId?: number | null;
  accessoryEquipmentType?: LoanedEquipmentType | null;
  accessoryLabel: string;
  accessorySerialCode: string;
  /** Current warehouse status of the accessory unit; null when unregistered. */
  physicalStatus?: InventorySerialPhysicalStatus | null;
  /** True only when the accessory unit is currently in the warehouse. */
  isAvailable?: boolean;
}

export interface CreateEquipmentDefaultAccessoryDto {
  parentEquipmentType: LoanedEquipmentType;
  parentSerialCode: string;
  inventoryDefinitionId?: number | null;
  accessoryEquipmentType?: LoanedEquipmentType | null;
  accessorySerialCode: string;
}

export interface CreateEquipmentDefaultAccessoriesBatchDto {
  parentEquipmentType: LoanedEquipmentType;
  parentSerialCode: string;
  inventoryDefinitionId?: number | null;
  accessoryEquipmentType?: LoanedEquipmentType | null;
  accessorySerialCodes: string[];
}

export interface EquipmentDefaultAccessoryCountDto {
  parentEquipmentType: LoanedEquipmentType;
  parentSerialCode: string;
  count: number;
}
