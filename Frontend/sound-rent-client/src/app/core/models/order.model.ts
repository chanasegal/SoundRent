import { DepositType, LoanedEquipmentType, ReturnTimeType, TimeSlot } from './enums';

export interface LoanedEquipmentNoteDto {
  id?: number;
  ordinal: number;
  content?: string | null;
  isReturned?: boolean;
}

export interface OrderLoanedEquipmentDto {
  id?: number;
  isCustomItem?: boolean;
  loanedEquipmentType?: LoanedEquipmentType | null;
  customItemName?: string | null;
  quantity: number;
  returnedQuantity?: number;
  expectedNoteCount: number;
  notes: LoanedEquipmentNoteDto[];
}

export interface OrderShiftDto {
  orderDate: string; // ISO yyyy-MM-dd
  timeSlot: TimeSlot;
}

export interface OrderDto {
  id: number;
  /** Booking slot ids (e.g. 715-A, 910NX-B). */
  equipmentDefinitionIds: string[];
  shifts: OrderShiftDto[];
  customerName?: string | null;
  phone: string;
  phone2?: string | null;
  address?: string | null;
  institutionName?: string | null;
  institutionId?: number | null;
  depositType?: DepositType | null;
  depositOnName?: string | null;
  paymentAmount?: number | null;
  isUnpaid: boolean;
  isCancelled: boolean;
  isReturnProcessed: boolean;
  returnTimeType: ReturnTimeType;
  customReturnTime?: string | null;
  notes?: string | null;
  /** Board-only urgent note shown under return time on the weekly grid. */
  urgentBoardNote?: string | null;
  createdAt: string;
  loanedEquipments: OrderLoanedEquipmentDto[];
}

export interface OrderCreateUpdateDto {
  /** Booking slot ids (e.g. 715-A, 910NX-B). */
  equipmentDefinitionIds: string[];
  shifts: OrderShiftDto[];
  customerName?: string | null;
  phone: string;
  phone2?: string | null;
  address?: string | null;
  institutionName?: string | null;
  institutionId?: number | null;
  depositType?: DepositType | null;
  depositOnName?: string | null;
  paymentAmount?: number | null;
  isUnpaid: boolean;
  returnTimeType: ReturnTimeType;
  customReturnTime?: string | null;
  notes?: string | null;
  loanedEquipments: OrderLoanedEquipmentDto[];
  /** Legacy field; server-side validation now blocks overlapping grid cells. */
  allowDoubleBooking?: boolean;
}

/** Response of `GET /api/orders/check-institution-conflict`. */
export interface InstitutionConflictDto {
  hasConflict: boolean;
  conflictingOrderId?: number | null;
  conflictingCustomerName?: string | null;
  institutionNote?: string | null;
  conflictDate?: string | null;
}
