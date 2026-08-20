/**
 * Compare item/serial/tool codes for display order.
 * Pure numeric strings use a - b; otherwise natural (numeric) string compare.
 */
export function compareNumericCodes(a: string, b: string): number {
  const aTrim = (a ?? '').trim();
  const bTrim = (b ?? '').trim();
  const aNum = Number(aTrim);
  const bNum = Number(bTrim);
  if (aTrim !== '' && bTrim !== '' && Number.isFinite(aNum) && Number.isFinite(bNum)) {
    return aNum - bNum;
  }
  return aTrim.localeCompare(bTrim, undefined, { numeric: true, sensitivity: 'base' });
}

export function sortNumericCodes(codes: readonly string[]): string[] {
  return [...codes].sort(compareNumericCodes);
}
