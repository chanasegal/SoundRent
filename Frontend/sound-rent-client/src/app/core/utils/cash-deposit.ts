export const CASH_DEPOSIT_AMOUNT_INVALID_MESSAGE = 'סכום הפיקדון במזומן חייב להיות מספר גדול מאפס';

/**
 * Parses a free-text cash deposit input.
 * Returns `null` when left blank (no cash deposit) and `undefined` when the text is not a positive amount.
 */
export function parseCashDepositAmount(raw: string | number | null | undefined): number | null | undefined {
  const text = String(raw ?? '').trim().replace(/[,₪\s]/g, '');
  if (!text) {
    return null;
  }
  const amount = Number(text);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

export function formatCashAmount(amount: number): string {
  return `₪${Number(amount).toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}
