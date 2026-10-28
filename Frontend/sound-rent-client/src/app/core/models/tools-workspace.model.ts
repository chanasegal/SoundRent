export interface ToolDefinitionDto {
  id: number;
  displayName: string;
  sortOrder: number;
  totalQuantity: number;
  /**
   * When false, stock is quantity-only (no serial codes).
   * Defaults to true when omitted (older payloads).
   */
  requiresCode?: boolean;
  serialCodes: string[];
}

/** True unless the catalog row is explicitly marked quantity-only. */
export function toolDefinitionRequiresCode(
  def: Pick<ToolDefinitionDto, 'requiresCode'> | null | undefined
): boolean {
  return def?.requiresCode !== false;
}

export interface ToolDefinitionCreateDto {
  displayName: string;
  quantity?: number | null;
  /** When false, stock is quantity-only and serials are not created. Defaults to true. */
  requiresCode?: boolean;
  serialCodes?: string[];
}

export interface ToolDefinitionUpdateDto {
  displayName: string;
}

export interface ToolDefinitionSerialsUpdateDto {
  serialCodes: string[];
}

export interface ToolDefinitionTypeUpdateDto {
  id: number;
  /** Optional rename when saving an inventory row inline. */
  displayName?: string | null;
  requiresCode?: boolean | null;
  quantity?: number | null;
  serialCodes: string[];
}

export interface ToolDefinitionBatchUpdateDto {
  items: ToolDefinitionTypeUpdateDto[];
}

export interface ToolSerialLocationDto {
  serialCode: string;
  toolName: string;
  toolDefinitionId?: number | null;
  isRegistered: boolean;
  isInWarehouse: boolean;
  loanId?: number | null;
  clientName?: string | null;
  phone?: string | null;
  phone2?: string | null;
  address?: string | null;
  deposit?: string | null;
  notes?: string | null;
  /** Stored Hebrew lent display from the active loan (may include time). */
  hebrewLentDisplay?: string | null;
  /** Gregorian loan date (yyyy-MM-dd) for Hebrew calendar conversion. */
  loanDate?: string | null;
}

/** Type-level locator (quantity-only tools — holders by loan/customer). */
export interface ToolTypeLocationDto {
  toolDefinitionId: number;
  toolName: string;
  requiresCode: boolean;
  totalQuantity: number;
  loanedQuantity: number;
  availableQuantity: number;
  holders: ToolTypeHolderDto[];
}

export interface ToolTypeHolderDto {
  loanId: number;
  quantity: number;
  clientName?: string | null;
  phone?: string | null;
  phone2?: string | null;
  address?: string | null;
  deposit?: string | null;
  notes?: string | null;
  hebrewLentDisplay?: string | null;
  loanDate?: string | null;
}

export interface ToolAvailableSerialsGroupDto {
  toolDefinitionId: number;
  serialCodes: string[];
  /** Remaining units available to loan (serial count or quantity-only remainder). */
  availableQuantity?: number;
}

export interface ToolLoanItemDto {
  id: number;
  toolDefinitionId: number;
  toolName: string;
  serialCode: string;
  /** When this unit was added to the loan; later than the loan's `lentAt` if added on edit. */
  addedAt?: string | null;
  returnedAt?: string | null;
  hebrewReturnedDisplay?: string | null;
  chargeAmount?: number | null;
  chargeIsPaid?: boolean | null;
  customerDebtId?: number | null;
}

/** Origin of a row returned by tools customer loan history. */
export type ToolLoanSource = 'tools' | 'accessory';

export interface ToolLoanDto {
  id: number;
  /** `tools` for ToolLoan rows; `accessory` for standalone השאלת אביזרים orders. */
  loanSource?: ToolLoanSource | string | null;
  lentAt: string;
  hebrewLentDisplay: string;
  clientName: string;
  phone: string;
  phone2?: string | null;
  address?: string | null;
  institutionName?: string | null;
  institutionId?: number | null;
  deposit?: string | null;
  cashDepositAmount?: number | null;
  depositReturned?: boolean;
  notes?: string | null;
  deadlineAt?: string | null;
  returnedAt?: string | null;
  hebrewReturnedDisplay?: string | null;
  items: ToolLoanItemDto[];
}

export interface ToolLoanItemCreateDto {
  toolDefinitionId: number;
  serialCode: string;
  /** Display name for one-off items when toolDefinitionId is 0. */
  toolName?: string | null;
}

export interface ToolLoanCreateDto {
  clientName: string;
  phone: string;
  phone2?: string | null;
  address?: string | null;
  institutionName?: string | null;
  institutionId?: number | null;
  deposit?: string | null;
  /** Cash held as deposit; creates an open entry in the central deposits ledger. */
  cashDepositAmount?: number | null;
  /** Null leaves the existing flag unchanged on update. */
  depositReturned?: boolean | null;
  notes?: string | null;
  hebrewLentDisplay: string;
  deadlineAt?: string | null;
  items: ToolLoanItemCreateDto[];
}

export interface ToolLoanReturnDto {
  hebrewReturnedDisplay: string;
  chargeAmount?: number | null;
}

export interface ToolLoanReturnByCodeDto {
  toolDefinitionId: number;
  serialCode: string;
  hebrewReturnedDisplay: string;
  chargeAmount?: number | null;
}

export interface ToolItemBorrowHistoryDto {
  loanId: number;
  itemId: number;
  toolDefinitionId: number;
  toolName: string;
  serialCode: string;
  clientName: string;
  phone: string;
  address?: string | null;
  lentAt: string;
  hebrewLentDisplay: string;
  deadlineAt?: string | null;
  returnedAt: string;
  hebrewReturnedDisplay?: string | null;
  chargeAmount?: number | null;
  chargeIsPaid?: boolean | null;
  customerDebtId?: number | null;
}
