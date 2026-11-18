import { LOANED_EQUIPMENT_ORDER, LoanedEquipmentType } from '../models/enums';
import { EquipmentDefaultAccessoryDto } from '../models/equipment-default-accessory.model';

/** Grouped kit slots for one catalog definition (or type fallback). */
export interface MixerDefaultAccessoryGroup {
  inventoryDefinitionId: number | null;
  type: LoanedEquipmentType | null;
  codes: string[];
  uncodedCount: number;
}

export function isSameSerialCode(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), undefined, { sensitivity: 'accent' }) === 0;
}

/** Tablet VK / desktop Enter detection (key, code, and legacy keyCode). */
export function isEnterKey(event: KeyboardEvent): boolean {
  return (
    event.key === 'Enter' ||
    event.code === 'Enter' ||
    event.code === 'NumpadEnter' ||
    (event as KeyboardEvent & { keyCode?: number }).keyCode === 13
  );
}

export function splitTypedCodes(raw: string): string[] {
  return raw
    .split(/[\s,;|]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * Kit floor for merging mixer default accessories into an existing row.
 * Uses template codes already present + uncoded kit slots — never
 * `currentCodes.length + uncodedCount`, so user-filled 0/1 slots do not
 * double-count to 2 on re-apply.
 */
export function computeKitMergeQuantity(
  existingQuantity: number,
  currentCodes: string[],
  templateCodes: string[],
  uncodedCount: number
): number {
  const presentTemplateCodeCount = templateCodes.filter((code) =>
    currentCodes.some((c) => isSameSerialCode(c, code))
  ).length;
  const kitRequired = presentTemplateCodeCount + uncodedCount;
  return Math.max(existingQuantity, kitRequired, currentCodes.length, 1);
}

/**
 * Group mixer default-accessory API rows by catalog definition (preferred)
 * or system type. Empty serials increment `uncodedCount`.
 */
export function groupMixerDefaultAccessories(
  defaults: EquipmentDefaultAccessoryDto[]
): {
  byDefinition: MixerDefaultAccessoryGroup[];
  byType: Array<{ type: LoanedEquipmentType; codes: string[]; uncodedCount: number }>;
} {
  const byDefinition = new Map<number, MixerDefaultAccessoryGroup>();
  const byType = new Map<LoanedEquipmentType, { codes: string[]; uncodedCount: number }>();

  for (const row of defaults) {
    const code = (row.accessorySerialCode ?? '').trim();
    if (row.inventoryDefinitionId != null && row.inventoryDefinitionId > 0) {
      const key = row.inventoryDefinitionId;
      const existing = byDefinition.get(key) ?? {
        inventoryDefinitionId: key,
        type: (row.accessoryEquipmentType as LoanedEquipmentType | null) ?? null,
        codes: [],
        uncodedCount: 0
      };
      if (!code) {
        existing.uncodedCount += 1;
      } else if (!existing.codes.some((c) => isSameSerialCode(c, code))) {
        existing.codes.push(code);
      }
      byDefinition.set(key, existing);
      continue;
    }

    const type = row.accessoryEquipmentType as LoanedEquipmentType | null;
    if (!type || !LOANED_EQUIPMENT_ORDER.includes(type)) {
      continue;
    }
    const existing = byType.get(type) ?? { codes: [], uncodedCount: 0 };
    if (!code) {
      existing.uncodedCount += 1;
    } else if (!existing.codes.some((c) => isSameSerialCode(c, code))) {
      existing.codes.push(code);
    }
    byType.set(type, existing);
  }

  return {
    byDefinition: [...byDefinition.values()],
    byType: [...byType.entries()].map(([type, group]) => ({ type, ...group }))
  };
}
