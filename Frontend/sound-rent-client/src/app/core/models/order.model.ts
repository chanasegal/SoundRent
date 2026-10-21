import { DepositType, LoanedEquipmentType, ReturnTimeType, SystemType, TimeSlot } from './enums';

export interface LoanedEquipmentNoteDto {
  id?: number;
  ordinal: number;
  content?: string | null;
  isReturned?: boolean;
  /** Server-assigned UTC return stamp when this serial was checked in. */
  returnedAt?: string | null;
}

export interface OrderLoanedEquipmentDto {
  id?: number;
  inventoryDefinitionId?: number | null;
  isCustomItem?: boolean;
  loanedEquipmentType?: LoanedEquipmentType | null;
  customItemName?: string | null;
  quantity: number;
  returnedQuantity?: number;
  expectedNoteCount: number;
  notes: LoanedEquipmentNoteDto[];
  /** Server-assigned; later than the order's `createdAt` if the line was added on edit. */
  addedAt?: string | null;
  /** Server-assigned latest quantity-only return stamp. */
  returnedAt?: string | null;
}

export interface OrderShiftDto {
  orderDate: string; // ISO yyyy-MM-dd
  timeSlot: TimeSlot;
}

export interface OrderDto {
  id: number;
  /** Booking slot ids (e.g. 715-A, 910NX-B). */
  equipmentDefinitionIds: string[];
  /** When each booking slot id was added to the order. */
  equipmentAddedAt?: Record<string, string>;
  shifts: OrderShiftDto[];
  customerName?: string | null;
  phone: string;
  phone2?: string | null;
  address?: string | null;
  institutionName?: string | null;
  institutionId?: number | null;
  depositType?: DepositType | null;
  depositOnName?: string | null;
  cashDepositAmount?: number | null;
  /** True when the cash deposit was marked returned to the customer. */
  depositReturned?: boolean;
  paymentAmount?: number | null;
  /** Paid in advance. Mutually exclusive with `isUnpaid`. */
  isPaid?: boolean;
  /** Recorded as an open debt (shown in the debts report). */
  isUnpaid: boolean;
  isCancelled: boolean;
  isReturnProcessed: boolean;
  returnTimeType: ReturnTimeType;
  customReturnTime?: string | null;
  notes?: string | null;
  /** Board-only urgent note shown under return time on the weekly grid. */
  urgentBoardNote?: string | null;
  createdAt: string;
  systemType?: SystemType;
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
  /** Required (> 0) when `depositType` is Cash; ignored by the server otherwise. */
  cashDepositAmount?: number | null;
  /** Null leaves the existing flag unchanged on update. */
  depositReturned?: boolean | null;
  paymentAmount?: number | null;
  isPaid?: boolean;
  isUnpaid: boolean;
  returnTimeType: ReturnTimeType;
  customReturnTime?: string | null;
  notes?: string | null;
  loanedEquipments: OrderLoanedEquipmentDto[];
  /** Legacy field; server-side validation now blocks overlapping grid cells. */
  allowDoubleBooking?: boolean;
  systemType?: SystemType;
}

export interface CreateManualCancelledOrderDto {
  customerName?: string | null;
  phone: string;
  address?: string | null;
  equipmentDefinitionIds: string[];
  startDate: string;
  endDate: string;
  totalAmount?: number | null;
  deposit?: string | null;
  notes?: string | null;
  systemType?: SystemType;
}

/** Response of `GET /api/orders/check-institution-conflict`. */
export interface InstitutionConflictDto {
  hasConflict: boolean;
  conflictingOrderId?: number | null;
  conflictingCustomerName?: string | null;
  institutionNote?: string | null;
  conflictDate?: string | null;
}
