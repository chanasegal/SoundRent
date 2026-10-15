import { SystemType } from './enums';

export type CashDepositStatus = 'Open' | 'Returned';

export interface CashDepositDto {
  id: number;
  customerName: string;
  phone: string;
  address?: string | null;
  amount: number;
  receivedAt: string;
  sourceModule: SystemType;
  sourceModuleLabel: string;
  orderId?: number | null;
  toolLoanId?: number | null;
  bookLoanId?: number | null;
  /** e.g. "הזמנה #120" / "השאלה #45". */
  sourceReference: string;
  status: CashDepositStatus;
  returnedAt?: string | null;
  notes?: string | null;
}
