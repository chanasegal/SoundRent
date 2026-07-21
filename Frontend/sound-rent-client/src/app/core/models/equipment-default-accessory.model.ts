import { LoanedEquipmentType } from './enums';

export interface EquipmentDefaultAccessoryDto {
  id: number;
  parentEquipmentType: LoanedEquipmentType;
  parentSerialCode: string;
  parentLabel: string;
  accessoryEquipmentType: LoanedEquipmentType;
  accessoryLabel: string;
  accessorySerialCode: string;
}

export interface CreateEquipmentDefaultAccessoryDto {
  parentEquipmentType: LoanedEquipmentType;
  parentSerialCode: string;
  accessoryEquipmentType: LoanedEquipmentType;
  accessorySerialCode: string;
}

export interface CreateEquipmentDefaultAccessoriesBatchDto {
  parentEquipmentType: LoanedEquipmentType;
  parentSerialCode: string;
  accessoryEquipmentType: LoanedEquipmentType;
  accessorySerialCodes: string[];
}

export interface EquipmentDefaultAccessoryCountDto {
  parentEquipmentType: LoanedEquipmentType;
  parentSerialCode: string;
  count: number;
}
