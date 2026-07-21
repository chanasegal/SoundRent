export type DebtCategory = 'Tools' | 'Amplification' | 'Library' | 0 | 1 | 2;

export interface OpenDebtGroupDto {
  groupKey: string;
  customerName: string;
  phone: string;
  category: DebtCategory;
  categoryLabel: string;
  totalAmount: number;
  equipmentSummary: string;
  deposit?: string | null;
  sessionDate: string;
  debtIds: number[];
  orderIds: number[];
}

export interface MarkOpenDebtGroupPaidDto {
  debtIds: number[];
  orderIds: number[];
}

export interface CreateOpenDebtDto {
  customerName?: string | null;
  phone: string;
  address?: string | null;
  category: DebtCategory;
  itemDescription?: string | null;
  deposit?: string | null;
  amount: number;
}

export interface CreatedOpenDebtDto {
  debtId: number;
  group: OpenDebtGroupDto;
}

export const DEBT_CATEGORY_OPTIONS: ReadonlyArray<{ value: DebtCategory; label: string }> = [
  { value: 'Amplification', label: 'הגברה' },
  { value: 'Tools', label: 'כלי עבודה' },
  { value: 'Library', label: 'ספריה' }
];
