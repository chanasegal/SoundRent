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

/** Sum open cash-deposit ledger amounts (ignores non-positive rows). */
export function sumOpenCashDepositAmount(
  deposits: ReadonlyArray<{ amount: number | null | undefined }>
): number {
  return deposits.reduce((sum, d) => {
    const n = Number(d.amount ?? 0);
    return n > 0 ? sum + n : sum;
  }, 0);
}

/**
 * Global open-cash-deposit warning copy (order form banner + board/search tooltips).
 * Amount is the exact ledger total still held for the customer.
 */
export function buildOpenCashDepositAlertMessage(amount: number): string {
  if (!(amount > 0)) {
    return '';
  }
  const formatted = Number(amount).toLocaleString('he-IL', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  });
  return `שים לב: ללקוח זה יש פיקדון מזומן פתוח על סך ${formatted}`;
}
