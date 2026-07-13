import { EquipmentType, SystemType } from './enums';

export interface WaitlistEntryDto {
  id: number;
  customerName?: string | null;
  phone: string;
  equipmentType: EquipmentType;
  date: string;
  notes?: string | null;
  createdAt: string;
  systemType?: SystemType;
}

export interface WaitlistEntryCreateDto {
  customerName?: string | null;
  phone: string;
  equipmentType: EquipmentType;
  date: string;
  notes?: string | null;
  /** Saved to the customer directory only (not stored on the waitlist row). */
  address?: string | null;
  systemType?: SystemType;
}
