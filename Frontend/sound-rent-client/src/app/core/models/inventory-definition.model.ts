export type InventorySerialPhysicalStatus = 'InWarehouse' | 'LoanedOut' | 'Missing' | 'InRepair';

export interface InventorySerialUnitDto {
  serialCode: string;
  physicalStatus: InventorySerialPhysicalStatus;
  statusLabel: string;
  holderCustomerName?: string | null;
  holderPhone?: string | null;
  holderAddress?: string | null;
  /** yyyy-MM-dd when marked missing / loaned. */
  markedMissingAt?: string | null;
  /** Parent mixer serial id when this accessory is attached. */
  mixerId?: number | null;
  /** Parent mixer unit code when mixerId is set. */
  mixerSerialCode?: string | null;
}

export interface InventoryHolderDto {
  serialCode?: string | null;
  status: InventorySerialPhysicalStatus;
  statusLabel: string;
  customerName?: string | null;
  phone?: string | null;
  address?: string | null;
  eventDate?: string | null;
  orderId?: number | null;
}

export interface InventoryDefinitionDto {
  id: number;
  displayName: string;
  sortOrder: number;
  totalQuantity: number;
  serialCodes: string[];
  /** Per-unit status and holder details (aligned with serialCodes when present). */
  serialUnits?: InventorySerialUnitDto[];
  /** Aggregated row status from backend. */
  aggregateStatus?: InventorySerialPhysicalStatus;
  aggregateStatusLabel?: string;
  activeHolders?: InventoryHolderDto[];
}

export interface InventoryDefinitionRowUpdateDto {
  displayName: string;
  quantity?: number | null;
  serialCodes?: string[];
}

export interface InventoryDefinitionCreateDto {
  displayName: string;
  /** Optional; null/undefined/empty → 0. When > 0, that many units are tracked. */
  quantity?: number | null;
  /** Optional; blank slots auto-generate sequential codes (1, 2, 3…). */
  serialCodes?: string[];
}

export interface InventoryDefinitionEnsureDto {
  displayName: string;
}

export interface InventoryDefinitionUpdateDto {
  displayName: string;
}

export interface InventoryDefinitionSerialsUpdateDto {
  serialCodes: string[];
}

export interface InventoryDefinitionSerialStatusUpdateDto {
  serialCode: string;
  status: InventorySerialPhysicalStatus;
}

export interface InventoryDefinitionTypeUpdateDto {
  id: number;
  /** Optional stock quantity for custom (unlinked) catalog rows. */
  quantity?: number | null;
  serialCodes: string[];
}

export interface InventoryDefinitionBatchUpdateDto {
  items: InventoryDefinitionTypeUpdateDto[];
}
