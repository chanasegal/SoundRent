export type DebtCategory = 'Tools' | 'Amplification' | 'Library' | 0 | 1 | 2;

export interface OpenDebtGroupDto {
  groupKey: string;
  customerName: string;
  phone: string;
  category: DebtCategory;
  categoryLabel: string;
  totalAmount: number;
  equipmentSummary: string;
  sessionDate: string;
  debtIds: number[];
  orderIds: number[];
}

export interface MarkOpenDebtGroupPaidDto {
  debtIds: number[];
  orderIds: number[];
}
