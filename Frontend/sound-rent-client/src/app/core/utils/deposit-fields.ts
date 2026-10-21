import { DEPOSIT_TYPE_LABELS, DepositType } from '../models/enums';

export const CASH_DEPOSIT_AMOUNT_REQUIRED_MESSAGE = 'יש להזין סכום פיקדון במזומן';

const DEPOSIT_TYPE_ORDER: DepositType[] = [
  DepositType.Check,
  DepositType.CreditCard,
  DepositType.Cash
];

/** Labels used when encoding type into Tools/Library free-text `deposit`. */
const DEPOSIT_TEXT_LABELS: Record<DepositType, string> = {
  [DepositType.Check]: DEPOSIT_TYPE_LABELS[DepositType.Check],
  [DepositType.CreditCard]: DEPOSIT_TYPE_LABELS[DepositType.CreditCard],
  [DepositType.Cash]: DEPOSIT_TYPE_LABELS[DepositType.Cash]
};

/** Older ToolLoanService formatting used a shorter credit-card label. */
const DEPOSIT_TEXT_LABEL_ALIASES: Partial<Record<DepositType, string[]>> = {
  [DepositType.CreditCard]: ['אשראי'],
  [DepositType.Check]: ["צ'ק", 'צק']
};

export const DEPOSIT_TYPE_OPTIONS: DepositType[] = DEPOSIT_TYPE_ORDER;

/**
 * Formats deposit type + holder name the same way Amplification / accessory orders
 * surface deposits (type — name). Used when Tools/Library only store a free-text field.
 */
export function formatLoanDepositText(
  depositType: DepositType | null | undefined,
  depositOnName: string | null | undefined
): string | null {
  const typeLabel = depositType != null ? DEPOSIT_TEXT_LABELS[depositType] ?? null : null;
  const onName = (depositOnName ?? '').trim();
  if (!typeLabel && !onName) {
    return null;
  }
  if (!typeLabel) {
    return onName;
  }
  return onName ? `${typeLabel} — ${onName}` : typeLabel;
}

/**
 * Restores deposit type + holder name from a Tools/Library free-text deposit
 * (and optional cash amount, which forces Cash when present).
 */
export function parseLoanDepositText(
  deposit: string | null | undefined,
  cashDepositAmount?: number | null
): { depositType: DepositType | null; depositOnName: string } {
  const text = (deposit ?? '').trim();
  const hasCash = cashDepositAmount != null && Number(cashDepositAmount) > 0;

  if (!text) {
    return { depositType: hasCash ? DepositType.Cash : null, depositOnName: '' };
  }

  // Cash amount on the loan wins over a conflicting type label in free text.
  if (hasCash) {
    for (const label of depositLabelVariants(DepositType.Cash)) {
      if (text === label) {
        return { depositType: DepositType.Cash, depositOnName: '' };
      }
      for (const sep of [' — ', ' - ', ' – ']) {
        const prefix = `${label}${sep}`;
        if (text.startsWith(prefix)) {
          return { depositType: DepositType.Cash, depositOnName: text.slice(prefix.length).trim() };
        }
      }
    }
    return { depositType: DepositType.Cash, depositOnName: text };
  }

  for (const type of DEPOSIT_TYPE_ORDER) {
    for (const label of depositLabelVariants(type)) {
      if (text === label) {
        return { depositType: type, depositOnName: '' };
      }
      for (const sep of [' — ', ' - ', ' – ']) {
        const prefix = `${label}${sep}`;
        if (text.startsWith(prefix)) {
          return { depositType: type, depositOnName: text.slice(prefix.length).trim() };
        }
      }
    }
  }

  return { depositType: null, depositOnName: text };
}

export function parseDepositTypeSelectValue(raw: string | null | undefined): DepositType | null {
  const value = (raw ?? '').trim();
  if (!value) {
    return null;
  }
  return DEPOSIT_TYPE_ORDER.includes(value as DepositType) ? (value as DepositType) : null;
}

function depositLabelVariants(type: DepositType): string[] {
  const primary = DEPOSIT_TEXT_LABELS[type];
  const aliases = DEPOSIT_TEXT_LABEL_ALIASES[type] ?? [];
  return [primary, ...aliases];
}
