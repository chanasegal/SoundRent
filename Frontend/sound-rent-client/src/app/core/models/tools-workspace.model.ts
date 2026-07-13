export interface ToolDefinitionDto {
  id: number;
  displayName: string;
  sortOrder: number;
  totalQuantity: number;
  serialCodes: string[];
}

export interface ToolDefinitionCreateDto {
  displayName: string;
  quantity?: number | null;
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
}

export interface ToolLoanItemDto {
  id: number;
  toolDefinitionId: number;
  toolName: string;
  serialCode: string;
  returnedAt?: string | null;
  hebrewReturnedDisplay?: string | null;
}

export interface ToolLoanDto {
  id: number;
  lentAt: string;
  hebrewLentDisplay: string;
  clientName: string;
  phone: string;
  deposit?: string | null;
  notes?: string | null;
  deadlineAt?: string | null;
  returnedAt?: string | null;
  hebrewReturnedDisplay?: string | null;
  items: ToolLoanItemDto[];
}

export interface ToolLoanItemCreateDto {
  toolDefinitionId: number;
  serialCode: string;
}

export interface ToolLoanCreateDto {
  clientName: string;
  phone: string;
  deposit?: string | null;
  notes?: string | null;
  hebrewLentDisplay: string;
  deadlineAt?: string | null;
  items: ToolLoanItemCreateDto[];
}

export interface ToolLoanReturnDto {
  hebrewReturnedDisplay: string;
}
