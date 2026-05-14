import { EquipmentType } from './enums';

/**
 * Maps a booking slot id to the coarse equipment type used for maintenance mode
 * (must stay aligned with backend `BookingEquipmentSlots.TryGetMaintenanceEquipmentType`).
 */
export function bookingSlotToBaseEquipment(slot: string | null | undefined): EquipmentType | null {
  if (!slot) {
    return null;
  }
  const s = slot.trim();
  if (s.startsWith('712-')) {
    return EquipmentType.Speaker712;
  }
  if (s.startsWith('315-')) {
    return EquipmentType.Speaker315;
  }
  if (s.startsWith('310-')) {
    return EquipmentType.Speaker310;
  }
  if (s.startsWith('710-')) {
    return EquipmentType.Speaker710;
  }
  if (s.startsWith('715-')) {
    return EquipmentType.Speaker715;
  }
  if (s.startsWith('912-')) {
    return EquipmentType.Speaker912;
  }
  if (s.startsWith('910NX-')) {
    return EquipmentType.NX910;
  }
  if (s.startsWith('910ART-')) {
    return EquipmentType.ART910;
  }
  return null;
}

/** First grid slot for each legacy equipment type (waitlist → order, etc.). */
export function defaultBookingSlotForEquipmentType(eq: EquipmentType): string {
  switch (eq) {
    case EquipmentType.Speaker712:
      return '712-A';
    case EquipmentType.Speaker315:
      return '315-A';
    case EquipmentType.Speaker310:
      return '310-A';
    case EquipmentType.Speaker710:
      return '710-A';
    case EquipmentType.Speaker715:
      return '715-A';
    case EquipmentType.Speaker912:
      return '912-A';
    case EquipmentType.NX910:
      return '910NX-A';
    case EquipmentType.ART910:
      return '910ART-A';
    default:
      return '712-A';
  }
}

/**
 * Normalizes query-param values: accepts a known slot id, or legacy coarse enum strings.
 */
export function normalizeOrderEquipmentQueryParam(
  raw: string | null,
  isKnownSlot: (id: string) => boolean
): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (isKnownSlot(trimmed)) {
    return trimmed;
  }
  const legacy: Partial<Record<EquipmentType, string>> = {
    [EquipmentType.ART910]: '910ART-A',
    [EquipmentType.NX910]: '910NX-A',
    [EquipmentType.Speaker710]: '710-A',
    [EquipmentType.Speaker712]: '712-A',
    [EquipmentType.Speaker715]: '715-A',
    [EquipmentType.Speaker912]: '912-A',
    [EquipmentType.Speaker315]: '315-A',
    [EquipmentType.Speaker310]: '310-A'
  };
  const mapped = legacy[trimmed as EquipmentType];
  return mapped && isKnownSlot(mapped) ? mapped : null;
}
