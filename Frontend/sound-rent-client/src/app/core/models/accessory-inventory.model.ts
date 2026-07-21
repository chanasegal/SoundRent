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
  equipmentTypes?: LoanedEquipmentType[];
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

export interface AccessorySerialLocationDto {
  equipmentType: LoanedEquipmentType;
  label: string;
  serialCode: string;
  isRegistered: boolean;
  isInWarehouse: boolean;
  /** True when marked missing / unreturned (חסר / לא הוחזר). */
  isMissing?: boolean;
  orderId?: number | null;
  customerName?: string | null;
  phone?: string | null;
  phone2?: string | null;
  address?: string | null;
  deposit?: string | null;
  notes?: string | null;
  /** Earliest order shift date (yyyy-MM-dd) when loaned out / missing. */
  loanDate?: string | null;
}
