export enum LostEquipmentStatus {
  Pending = 'Pending',
  Notified = 'Notified',
  Returned = 'Returned'
}

export const LOST_EQUIPMENT_STATUS_LABELS: Record<LostEquipmentStatus, string> = {
  [LostEquipmentStatus.Pending]: 'ממתין',
  [LostEquipmentStatus.Notified]: 'הודיעו ללקוח',
  [LostEquipmentStatus.Returned]: 'הוחזר'
};

export interface LostEquipmentDto {
  id: number;
  customerName: string;
  itemDescription: string;
  hebrewDate: string;
  notes: string | null;
  status: LostEquipmentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LostEquipmentCreateDto {
  customerName: string;
  itemDescription: string;
  hebrewDate: string;
  notes?: string | null;
}

export interface LostEquipmentUpdateDto extends LostEquipmentCreateDto {
  status: LostEquipmentStatus;
}
