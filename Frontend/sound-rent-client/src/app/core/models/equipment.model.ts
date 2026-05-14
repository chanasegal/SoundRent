import { EquipmentType } from './enums';

export interface EquipmentDto {
  equipmentType: EquipmentType;
  isMaintenanceMode: boolean;
}
