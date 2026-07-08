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

/** Statuses that still need staff attention (not yet returned to the customer). */
export const LOST_EQUIPMENT_ACTIVE_STATUSES: ReadonlySet<LostEquipmentStatus> = new Set([
  LostEquipmentStatus.Pending,
  LostEquipmentStatus.Notified
]);

export interface LostEquipmentDto {
  id: number;
  customerName: string;
  phone: string | null;
  itemDescription: string;
  hebrewDate: string;
  notes: string | null;
  status: LostEquipmentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LostEquipmentCreateDto {
  customerName: string;
  phone?: string | null;
  itemDescription: string;
  hebrewDate: string;
  notes?: string | null;
}

export interface LostEquipmentUpdateDto extends LostEquipmentCreateDto {
  status: LostEquipmentStatus;
}
