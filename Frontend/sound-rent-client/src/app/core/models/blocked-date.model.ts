import { SystemType } from './enums';

export interface BlockedDateDto {
  id: number;
  startDate: string;
  endDate: string;
  reason?: string | null;
  createdAt: string;
  updatedAt: string;
  systemType?: SystemType;
}

export interface BlockedDateCreateDto {
  startDate: string;
  endDate: string;
  reason?: string | null;
  systemType?: SystemType;
}

export interface BlockedDateUpdateDto {
  startDate: string;
  endDate: string;
  reason?: string | null;
}

/** Returns the block covering `iso` (yyyy-MM-dd), if any. */
export function findBlockedDateForIso(
  iso: string,
  blocks: readonly BlockedDateDto[]
): BlockedDateDto | null {
  for (const block of blocks) {
    if (iso >= block.startDate && iso <= block.endDate) {
      return block;
    }
  }
  return null;
}

/** Human-readable label for a blocked free cell. */
export function blockedDateCellLabel(block: BlockedDateDto): string {
  const reason = block.reason?.trim();
  return reason ? `🔒 חסום: ${reason}` : '🔒 חסום';
}
