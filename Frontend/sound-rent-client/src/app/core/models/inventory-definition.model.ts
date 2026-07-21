export type InventorySerialPhysicalStatus = 'InWarehouse' | 'LoanedOut' | 'Missing';

export interface InventorySerialUnitDto {
  serialCode: string;
  physicalStatus: InventorySerialPhysicalStatus;
  statusLabel: string;
  holderCustomerName?: string | null;
  holderPhone?: string | null;
  holderAddress?: string | null;
  /** yyyy-MM-dd when marked missing / loaned. */
  markedMissingAt?: string | null;
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
  /** When set, this row backs a system LoanedEquipmentType (serials in AccessorySerialInventory). */
  linkedEquipmentType?: string | null;
}

export interface InventoryDefinitionCreateDto {
  displayName: string;
  /** Optional; null/undefined/empty → 0. When > 0, that many units are tracked. */
  quantity?: number | null;
  /** Optional; blank entries are ignored for custom items (no auto-generated codes). */
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

export interface InventoryDefinitionTypeUpdateDto {
  id: number;
  /** Optional stock quantity for custom (unlinked) catalog rows. */
  quantity?: number | null;
  serialCodes: string[];
}

export interface InventoryDefinitionBatchUpdateDto {
  items: InventoryDefinitionTypeUpdateDto[];
}
