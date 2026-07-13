export interface InventoryDefinitionDto {
  id: number;
  displayName: string;
  sortOrder: number;
  totalQuantity: number;
  serialCodes: string[];
  /** When set, this row backs a system LoanedEquipmentType (serials in AccessorySerialInventory). */
  linkedEquipmentType?: string | null;
}

export interface InventoryDefinitionCreateDto {
  displayName: string;
  /** Optional; null/undefined/empty → 0. When > 0, that many serial slots are created. */
  quantity?: number | null;
  /** Optional; blank entries get sequential fallbacks on the server. */
  serialCodes?: string[];
}

export interface InventoryDefinitionUpdateDto {
  displayName: string;
}

export interface InventoryDefinitionSerialsUpdateDto {
  serialCodes: string[];
}

export interface InventoryDefinitionTypeUpdateDto {
  id: number;
  serialCodes: string[];
}

export interface InventoryDefinitionBatchUpdateDto {
  items: InventoryDefinitionTypeUpdateDto[];
}
