export interface BookDto {
  id: number;
  title: string;
  author?: string | null;
  category?: string | null;
  sortOrder: number;
  totalQuantity: number;
  copies: string[];
}

export interface BookCreateDto {
  title: string;
  author?: string | null;
  category?: string | null;
  quantity?: number | null;
  copies?: string[];
}

export interface BookUpdateDto {
  title: string;
  author?: string | null;
  category?: string | null;
}

export interface BookCopiesUpdateDto {
  copies: string[];
}

export interface BookTypeUpdateDto {
  id: number;
  copies: string[];
}

export interface BookBatchUpdateDto {
  items: BookTypeUpdateDto[];
}

export interface BookCopyLocationDto {
  copyNumber: string;
  bookTitle: string;
  bookId?: number | null;
  isRegistered: boolean;
  isInWarehouse: boolean;
  loanId?: number | null;
  clientName?: string | null;
  phone?: string | null;
}

export interface BookAvailableCopiesGroupDto {
  bookId: number;
  copies: string[];
}

export interface BookLoanItemDto {
  id: number;
  bookId: number;
  bookTitle: string;
  copyNumber: string;
  returnedAt?: string | null;
  hebrewReturnedDisplay?: string | null;
  chargeAmount?: number | null;
  chargeIsPaid?: boolean | null;
  customerDebtId?: number | null;
}

export interface BookLoanDto {
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
  items: BookLoanItemDto[];
}

export interface BookLoanItemCreateDto {
  bookId: number;
  copyNumber: string;
}

export interface BookLoanCreateDto {
  clientName: string;
  phone: string;
  deposit?: string | null;
  notes?: string | null;
  hebrewLentDisplay: string;
  deadlineAt?: string | null;
  items: BookLoanItemCreateDto[];
}

export interface BookLoanReturnDto {
  hebrewReturnedDisplay: string;
  chargeAmount?: number | null;
}

export interface BookLoanReturnByCodeDto {
  bookId: number;
  copyNumber: string;
  hebrewReturnedDisplay: string;
  chargeAmount?: number | null;
}

export interface BookItemBorrowHistoryDto {
  loanId: number;
  itemId: number;
  bookId: number;
  bookTitle: string;
  copyNumber: string;
  clientName: string;
  phone: string;
  lentAt: string;
  hebrewLentDisplay: string;
  deadlineAt?: string | null;
  returnedAt: string;
  hebrewReturnedDisplay?: string | null;
  chargeAmount?: number | null;
  chargeIsPaid?: boolean | null;
  customerDebtId?: number | null;
}
