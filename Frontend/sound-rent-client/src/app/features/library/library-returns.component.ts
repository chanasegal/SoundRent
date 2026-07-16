import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
  viewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmationService } from 'primeng/api';
import { ConfirmPopup } from 'primeng/confirmpopup';
import { finalize } from 'rxjs/operators';

import {
  BookDto,
  BookItemBorrowHistoryDto,
  BookLoanDto,
  BookLoanItemDto
} from '../../core/models/library-workspace.model';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import {
  endOfLocalDay,
  formatLibraryDuration,
  libraryBillableDays
} from '../../core/utils/library-loan-duration';
import { BookTitleSelectComponent } from '../../shared/components/book-title-select.component';
import { AutoFocusDirective } from '../../shared/directives/auto-focus.directive';
import { BarcodeWedgeScanner } from '../../shared/utils/barcode-wedge-scanner';

interface CompletedLoanRowView {
  rowKey: string;
  loanId: number;
  itemId: number;
  customerDebtId: number | null;
  item: Pick<BookLoanItemDto, 'bookTitle' | 'copyNumber'>;
  clientName: string;
  phone: string;
  lentAt: Date;
  hebrewLentDisplay: string;
  deadlineAt: Date | null;
  returnedAt: Date;
  hebrewReturnedDisplay: string;
  chargeAmount: number | null;
  chargeIsPaid: boolean | null;
}

@Component({
  selector: 'app-library-returns',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, BookTitleSelectComponent, ConfirmPopup, AutoFocusDirective],
  providers: [ConfirmationService],
  templateUrl: './library-returns.component.html',
  styleUrl: './library-returns.component.scss'
})
export class LibraryReturnsComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly toast = inject(ToastService);
  private readonly confirmation = inject(ConfirmationService);
  protected readonly pageTitle = inject(WorkspaceUiService).title('החזרות');

  private readonly barcodeField = viewChild<ElementRef<HTMLInputElement>>('barcodeField');
  private readonly wedge = new BarcodeWedgeScanner();

  protected readonly loading = signal(true);
  protected readonly loans = signal<BookLoanDto[]>([]);
  protected readonly definitions = signal<BookDto[]>([]);
  protected readonly markingDebtId = signal<number | null>(null);
  protected readonly undoingRowKey = signal<string | null>(null);
  protected readonly deletingLoanId = signal<number | null>(null);

  /** Audit search — isolated to this component. */
  protected readonly historyToolId = signal<number | null>(null);
  protected readonly historyCode = signal('');
  protected readonly historySearching = signal(false);
  protected readonly historyMode = signal(false);
  protected readonly historyRows = signal<CompletedLoanRowView[]>([]);

  protected readonly historyCodes = computed(() => {
    const bookId = this.historyToolId();
    if (bookId == null) {
      return [] as string[];
    }
    const def = this.definitions().find((d) => d.id === bookId);
    return [...(def?.copies ?? [])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  });

  protected readonly allCompletedRows = computed(() => {
    const views: CompletedLoanRowView[] = [];

    for (const loan of this.loans()) {
      const lentAt = new Date(loan.lentAt);
      const deadlineAt = loan.deadlineAt ? new Date(loan.deadlineAt) : null;

      for (const item of loan.items) {
        if (!item.returnedAt) {
          continue;
        }
        const returnedAt = new Date(item.returnedAt);
        views.push({
          rowKey: `${loan.id}-${item.id}`,
          loanId: loan.id,
          itemId: item.id,
          customerDebtId: item.customerDebtId ?? null,
          item,
          clientName: loan.clientName,
          phone: loan.phone,
          lentAt,
          hebrewLentDisplay: this.dateOnlyDisplay(loan.hebrewLentDisplay, lentAt),
          deadlineAt,
          returnedAt,
          hebrewReturnedDisplay: this.dateOnlyDisplay(
            item.hebrewReturnedDisplay,
            returnedAt
          ),
          chargeAmount: item.chargeAmount ?? null,
          chargeIsPaid: item.chargeIsPaid ?? null
        });
      }
    }

    return views.sort((a, b) => b.returnedAt.getTime() - a.returnedAt.getTime());
  });

  protected readonly rows = computed(() =>
    this.historyMode() ? this.historyRows() : this.allCompletedRows()
  );

  ngOnInit(): void {
    this.data.getBooks().subscribe((list) => this.definitions.set(list));
    this.refresh();
  }

  /** Global wedge scan when no input is focused — fills barcode and searches history. */
  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    const code = this.wedge.push(event);
    if (!code) {
      return;
    }
    this.historyCode.set(code);
    this.searchItemHistory();
  }

  protected refresh(): void {
    this.loading.set(true);
    this.data
      .getBookLoans()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe((list) => {
        this.loans.set(list);
      });
  }

  protected onHistoryToolChange(bookId: number | null): void {
    this.historyToolId.set(bookId != null && bookId > 0 ? bookId : null);
    this.historyCode.set('');
  }

  protected onHistoryCodeInput(value: string): void {
    this.historyCode.set(value);
  }

  protected onHistoryKeydownEnter(event: Event): void {
    event.preventDefault();
    this.searchItemHistory();
  }

  protected searchItemHistory(): void {
    if (this.historySearching()) {
      return;
    }

    const serial = this.historyCode().trim();
    if (!serial) {
      this.toast.error('יש להזין ברקוד');
      this.focusBarcodeField();
      return;
    }

    let bookId = this.historyToolId();
    if (bookId == null) {
      const resolved = this.resolveBookFromDefinitions(serial);
      if (!resolved) {
        this.toast.error('יש לבחור ספר או לסרוק ברקוד מוכר במלאי');
        this.focusBarcodeField();
        return;
      }
      bookId = resolved;
      this.historyToolId.set(bookId);
    }

    this.historySearching.set(true);
    this.data
      .getBookItemBorrowHistory(bookId, serial)
      .pipe(finalize(() => this.historySearching.set(false)))
      .subscribe((list) => {
        this.historyRows.set(list.map((h) => this.toHistoryRow(h)));
        this.historyMode.set(true);
        this.focusBarcodeField();
      });
  }

  protected clearHistorySearch(): void {
    this.historyMode.set(false);
    this.historyRows.set([]);
    this.historyToolId.set(null);
    this.historyCode.set('');
    this.focusBarcodeField();
  }

  private resolveBookFromDefinitions(serial: string): number | null {
    const needle = serial.toLowerCase();
    const hits: number[] = [];
    for (const book of this.definitions()) {
      if ((book.copies ?? []).some((c) => c.toLowerCase() === needle)) {
        hits.push(book.id);
      }
    }
    return hits.length === 1 ? hits[0] : null;
  }

  private focusBarcodeField(): void {
    queueMicrotask(() => {
      const el = this.barcodeField()?.nativeElement;
      if (!el) {
        return;
      }
      el.focus();
      // Select leftover text so the next wedge scan replaces it.
      el.select();
    });
  }

  protected formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
  }

  protected formatDeadline(deadline: Date | null): string {
    if (!deadline) {
      return '—';
    }
    return this.formatHebrewDate(deadline);
  }

  protected durationText(row: CompletedLoanRowView): string {
    const days = libraryBillableDays(row.lentAt, row.returnedAt);
    return formatLibraryDuration(days, this.isOverdue(row));
  }

  protected isOverdue(row: CompletedLoanRowView): boolean {
    if (!row.deadlineAt) {
      return false;
    }
    return row.returnedAt.getTime() > endOfLocalDay(row.deadlineAt).getTime();
  }

  protected formatCharge(amount: number | null): string {
    if (amount == null || amount <= 0) {
      return '—';
    }
    return `${amount} ₪`;
  }

  protected hasCharge(row: CompletedLoanRowView): boolean {
    return row.chargeAmount != null && row.chargeAmount > 0;
  }

  protected canQuickPay(row: CompletedLoanRowView): boolean {
    return (
      this.hasCharge(row) &&
      row.chargeIsPaid !== true &&
      row.customerDebtId != null &&
      row.customerDebtId > 0
    );
  }

  protected onOpenBadgeClick(event: Event, row: CompletedLoanRowView): void {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canQuickPay(row) || this.markingDebtId() != null) {
      return;
    }

    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message: 'סמן חוב זה כמשולם?',
      acceptLabel: 'כן',
      rejectLabel: 'ביטול',
      acceptButtonStyleClass: 'p-button-sm',
      rejectButtonStyleClass: 'p-button-sm p-button-outlined',
      accept: () => this.markDebtPaid(row)
    });
  }

  protected onUndoReturnClick(event: Event, row: CompletedLoanRowView): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.undoingRowKey() != null || this.deletingLoanId() != null) {
      return;
    }

    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message: 'האם לבטל את ההחזרה ולהחזיר את הפריט לרשימת ההשאלות הפעילות?',
      acceptLabel: 'כן',
      rejectLabel: 'ביטול',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-sm p-button-outlined',
      accept: () => this.undoReturn(row)
    });
  }

  protected onDeleteLoanClick(event: Event, row: CompletedLoanRowView): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.undoingRowKey() != null || this.deletingLoanId() != null) {
      return;
    }

    this.confirmation.confirm({
      target: event.currentTarget as EventTarget,
      message:
        'האם למחוק לחלוטין את רשומת ההשאלה הזו מהמערכת? (פעולה זו בלתי הפיכה ותמחק גם חובות קשורים)',
      acceptLabel: 'מחק',
      rejectLabel: 'ביטול',
      acceptButtonStyleClass: 'p-button-sm p-button-danger',
      rejectButtonStyleClass: 'p-button-sm p-button-outlined',
      accept: () => this.deleteLoan(row)
    });
  }

  private undoReturn(row: CompletedLoanRowView): void {
    this.undoingRowKey.set(row.rowKey);
    this.data
      .undoBookLoanItemReturn(row.loanId, row.itemId)
      .pipe(finalize(() => this.undoingRowKey.set(null)))
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.removeReturnedRowLocally(row);
        this.toast.success('ההחזרה בוטלה — הפריט חזר להשאלות פעילות');
      });
  }

  private deleteLoan(row: CompletedLoanRowView): void {
    this.deletingLoanId.set(row.loanId);
    this.data
      .deleteBookLoan(row.loanId)
      .pipe(finalize(() => this.deletingLoanId.set(null)))
      .subscribe((ok) => {
        if (!ok) {
          return;
        }
        this.removeLoanLocally(row.loanId);
        this.toast.success('רשומת ההשאלה נמחקה');
      });
  }

  /** Drop the undone item from local lists without a full reload. */
  private removeReturnedRowLocally(row: CompletedLoanRowView): void {
    this.loans.update((list) =>
      list.map((loan) => {
        if (loan.id !== row.loanId) {
          return loan;
        }
        return {
          ...loan,
          returnedAt: null,
          hebrewReturnedDisplay: null,
          items: loan.items.map((item) =>
            item.id === row.itemId
              ? {
                  ...item,
                  returnedAt: null,
                  hebrewReturnedDisplay: null,
                  chargeAmount: null,
                  chargeIsPaid: null,
                  customerDebtId: null
                }
              : item
          )
        };
      })
    );

    if (this.historyMode()) {
      this.historyRows.update((list) => list.filter((r) => r.rowKey !== row.rowKey));
    }
  }

  /** Remove every local row belonging to a permanently deleted loan. */
  private removeLoanLocally(loanId: number): void {
    this.loans.update((list) => list.filter((loan) => loan.id !== loanId));
    if (this.historyMode()) {
      this.historyRows.update((list) => list.filter((r) => r.loanId !== loanId));
    }
  }

  private markDebtPaid(row: CompletedLoanRowView): void {
    const debtId = row.customerDebtId;
    if (debtId == null) {
      return;
    }
    this.markingDebtId.set(debtId);
    this.data
      .markCustomerDebtPaid(debtId)
      .pipe(finalize(() => this.markingDebtId.set(null)))
      .subscribe((ok) => {
        if (!ok) {
          return;
        }
        this.applyPaidLocally(row);
        this.toast.success('החוב סומן כשולם');
      });
  }

  /** Patch local state only — no full list reload. */
  private applyPaidLocally(row: CompletedLoanRowView): void {
    this.loans.update((list) =>
      list.map((loan) => ({
        ...loan,
        items: loan.items.map((item) =>
          item.id === row.itemId ? { ...item, chargeIsPaid: true } : item
        )
      }))
    );

    if (this.historyMode()) {
      this.historyRows.update((list) =>
        list.map((r) => (r.rowKey === row.rowKey ? { ...r, chargeIsPaid: true } : r))
      );
    }
  }

  private toHistoryRow(h: BookItemBorrowHistoryDto): CompletedLoanRowView {
    const lentAt = new Date(h.lentAt);
    const returnedAt = new Date(h.returnedAt);
    return {
      rowKey: `hist-${h.loanId}-${h.itemId}`,
      loanId: h.loanId,
      itemId: h.itemId,
      customerDebtId: h.customerDebtId ?? null,
      item: { bookTitle: h.bookTitle, copyNumber: h.copyNumber },
      clientName: h.clientName,
      phone: h.phone,
      lentAt,
      hebrewLentDisplay: this.dateOnlyDisplay(h.hebrewLentDisplay, lentAt),
      deadlineAt: h.deadlineAt ? new Date(h.deadlineAt) : null,
      returnedAt,
      hebrewReturnedDisplay: this.dateOnlyDisplay(h.hebrewReturnedDisplay, returnedAt),
      chargeAmount: h.chargeAmount ?? null,
      chargeIsPaid: h.chargeIsPaid ?? null
    };
  }

  private dateOnlyDisplay(stored: string | null | undefined, date: Date): string {
    const trimmed = (stored ?? '').trim();
    if (trimmed) {
      const withoutTime = trimmed.replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*$/, '').trim();
      if (withoutTime) {
        return withoutTime;
      }
    }
    return this.formatHebrewDate(date);
  }

  private formatHebrewDate(date: Date): string {
    return this.hebrew.toHebrew(date);
  }
}
