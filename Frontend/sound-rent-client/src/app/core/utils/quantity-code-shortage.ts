/** Soft warning when fewer serial codes are assigned than the requested quantity. */
export interface QuantityCodeShortage {
  itemName: string;
  actualCount: number;
  requestedCount: number;
}

export function quantityCodeShortageMessage(shortage: QuantityCodeShortage): string {
  return `שים לב: מילאת ${shortage.actualCount} מתוך ${shortage.requestedCount} עבור ${shortage.itemName}`;
}

export function isQuantityCodeShortage(actualCount: number, requestedCount: number): boolean {
  return requestedCount > 0 && actualCount < requestedCount;
}
