import { DepositType, LoanedEquipmentType, TimeSlot } from './enums';

export interface LoanedEquipmentNoteDto {
  id?: number;
  ordinal: number;
  content?: string | null;
}

export interface OrderLoanedEquipmentDto {
  id?: number;
  loanedEquipmentType: LoanedEquipmentType;
  quantity: number;
  expectedNoteCount: number;
  notes: LoanedEquipmentNoteDto[];
}

export interface OrderDto {
  id: number;
  /** Booking slot (e.g. 715-A, 910NX-B). */
  equipmentType: string;
  orderDate: string; // ISO yyyy-MM-dd
  timeSlot: TimeSlot;
  customerName?: string | null;
  phone: string;
  phone2?: string | null;
  address?: string | null;
  depositType?: DepositType | null;
  depositOnName?: string | null;
  paymentAmount?: number | null;
  isPaid: boolean;
  notes?: string | null;
  createdAt: string;
  loanedEquipments: OrderLoanedEquipmentDto[];
}

export interface OrderCreateUpdateDto {
  /** Booking slot (e.g. 715-A, 910NX-B). */
  equipmentType: string;
  orderDate: string; // ISO yyyy-MM-dd
  timeSlot: TimeSlot;
  customerName?: string | null;
  phone: string;
  phone2?: string | null;
  address?: string | null;
  depositType?: DepositType | null;
  depositOnName?: string | null;
  paymentAmount?: number | null;
  isPaid: boolean;
  notes?: string | null;
  loanedEquipments: OrderLoanedEquipmentDto[];
  /** When true, server allows another order in the same equipment/date/slot. */
  allowDoubleBooking?: boolean;
}
