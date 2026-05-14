import { EquipmentType } from './enums';

export interface WaitlistEntryDto {
  id: number;
  customerName?: string | null;
  phone: string;
  equipmentType: EquipmentType;
  date: string;
  notes?: string | null;
  createdAt: string;
}

export interface WaitlistEntryCreateDto {
  customerName?: string | null;
  phone: string;
  equipmentType: EquipmentType;
  date: string;
  notes?: string | null;
}
