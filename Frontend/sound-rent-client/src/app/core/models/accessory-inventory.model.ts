import { LoanedEquipmentType } from './enums';
import { OrderShiftDto } from './order.model';

export interface AccessoryInventoryGroupDto {
  equipmentType: LoanedEquipmentType;
  label: string;
  totalQuantity: number;
  serialCodes: string[];
}

export interface AccessoryInventoryUpdateDto {
  serialCodes: string[];
}

export interface AccessoryInventoryTypeUpdateDto {
  equipmentType: LoanedEquipmentType;
  serialCodes: string[];
}

export interface AccessoryInventoryBatchUpdateDto {
  items: AccessoryInventoryTypeUpdateDto[];
}

export interface AccessorySerialAvailabilityRequestDto {
  dates: string[];
  shifts?: OrderShiftDto[];
  excludeOrderId?: number | null;
}

export interface AccessorySerialOptionDto {
  serialCode: string;
  isAvailable: boolean;
}

export interface AccessorySerialAvailabilityGroupDto {
  equipmentType: LoanedEquipmentType;
  options: AccessorySerialOptionDto[];
}
