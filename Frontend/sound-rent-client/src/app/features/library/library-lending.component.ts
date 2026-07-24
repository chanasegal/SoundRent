import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, forkJoin, interval, Subject, EMPTY } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, switchMap } from 'rxjs/operators';

import { CustomerSuggestDto } from '../../core/models/customer.model';
import { SystemType } from '../../core/models/enums';
import {
  BookDto,
  BookLoanCreateDto,
  BookLoanDto,
  BookLoanItemDto
} from '../../core/models/library-workspace.model';
import { CustomersStore } from '../../core/services/customers.store';
import { BooksStore } from '../../core/services/books.store';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import {
  OrderDraftService,
  WorkspaceLendingDraftPayload
} from '../../core/services/order-draft.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import {
  addDaysToDate,
  endOfLocalDay,
  formatLibraryDuration,
  libraryBillableDays
} from '../../core/utils/library-loan-duration';
import { BookTitleSelectComponent } from '../../shared/components/book-title-select.component';
import { AutoFocusDirective } from '../../shared/directives/auto-focus.directive';
import { IsraeliPhoneInputDirective } from '../../shared/directives/israeli-phone-input.directive';
import { clampIsraeliPhoneDigits, ISRAELI_PHONE_INVALID_MESSAGE, isValidIsraeliPhone } from '../../core/validators/israeli-phone.validator';
import { BarcodeWedgeScanner } from '../../shared/utils/barcode-wedge-scanner';

interface BookLineItem {
  id: string;
  bookId: number | null;
  bookQuery: string;
  selectedCopies: string[];
  bookSuggestOpen: boolean;
  copiesOpen: boolean;
}

interface LendingDraftForm {
  id: string;
  createdAt: Date;
  hebrewDateTime: string;
  bookLines: BookLineItem[];
  clientName: string;
  phone: string;
  phone2: string;
  address: string;
  deposit: string;
  notes: string;
  clientAlertNotes: string | null;
  deadlineAt: Date | null;
}

interface ActiveLoanRowView {
  rowKey: string;
  loanId: number;
  itemId: number;
  item: BookLoanItemDto;
  clientName: string;
  phone: string;
  address: string;
  lentAt: Date;
  hebrewLentDisplay: string;
  deadlineAt: Date | null;
  returning: boolean;
}

interface ActiveLoanCustomerCard {
  key: string;
  customerName: string;
  phone: string;
  address: string;
  customerNotes: string | null;
  items: ActiveLoanRowView[];
}

@Component({
  selector: 'app-library-lending',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    FormsModule,
    BookTitleSelectComponent,
    AutoFocusDirective,
    IsraeliPhoneInputDirective
  ],
  templateUrl: './library-lending.component.html',
  styleUrl: './library-lending.component.scss'
})
export class LibraryLendingComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly booksStore = inject(BooksStore);
  private readonly customers = inject(CustomersStore);
  private readonly hebrew = inject(HebrewDateService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly orderDraft = inject(OrderDraftService);
  protected readonly pageTitle = inject(WorkspaceUiService).title('לוח השאלות');

  private pendingRenew: {
    phone: string;
    clientName: string;
    phone2: string;
    address: string;
    bookId: number;
    copyNumber: string;
  } | null = null;

  /** Quick-return barcode field — kept focused for sequential scanner wedges. */
  private readonly barcodeField = viewChild<ElementRef<HTMLInputElement>>('barcodeField');
  /** Loan-form barcode field (when the loan panel is open). */
  private readonly loanBarcodeField = viewChild<ElementRef<HTMLInputElement>>('loanBarcodeField');
  private readonly wedge = new BarcodeWedgeScanner();
  protected readonly loanScanCode = signal('');

  protected readonly definitions = this.booksStore.definitions;
  protected readonly availableByBook = signal<Map<number, string[]>>(new Map());
  protected readonly submittingId = signal<string | null>(null);
  /** Declared before `forms` — `createDraftForm()` reads this during field init. */
  protected readonly timeLimitEnabled = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly activeLoading = signal(true);
  protected readonly activeLoans = signal<BookLoanDto[]>([]);
  protected readonly returningItemId = signal<number | null>(null);
  protected readonly returningCustomerKey = signal<string | null>(null);
  protected readonly nowTick = signal(Date.now());
  protected readonly customerSuggestions = signal<CustomerSuggestDto[]>([]);
  protected readonly customerSuggestOpen = signal(false);
  protected readonly customerSuggestField = signal<'name' | 'phone' | null>(null);
  protected readonly customerSuggestFormId = signal<string | null>(null);
  private readonly customerSuggestQuery$ = new Subject<{
    formId: string;
    field: 'name' | 'phone';
    q: string;
  }>();

  /** Quick return by code — local page state only. */
  protected readonly quickReturnToolId = signal<number | null>(null);
  protected readonly quickReturnCode = signal('');
  protected readonly quickReturnCharge = signal('');
  protected readonly quickReturning = signal(false);
  /** Inline charge amounts keyed by loan item id (local only). */
  protected readonly rowCharges = signal<Record<number, string>>({});

  protected readonly quickReturnCodes = computed(() => {
    const bookId = this.quickReturnToolId();
    if (bookId == null) {
      return [] as string[];
    }
    const def = this.definitions().find((d) => d.id === bookId);
    return [...(def?.copies ?? [])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  });

  protected readonly timeLimitForm = this.fb.group({
    days: [7, [Validators.required, Validators.min(1), Validators.max(365)]]
  });

  protected readonly forms = signal<LendingDraftForm[]>([this.createDraftForm()]);

  protected readonly showDeadline = computed(() => this.timeLimitEnabled());

  constructor() {
    effect(() => {
      this.orderDraft.resumeTick();
      untracked(() => this.tryRestoreMinimizedDraft());
    });
  }

  /** Local filter for the active-loans table — never triggers HTTP. */
  protected readonly activeSearchInput = this.fb.nonNullable.control('');
  protected readonly activeSearchQuery = signal('');

  protected readonly activeRows = computed(() => {
    this.nowTick();
    const views: ActiveLoanRowView[] = [];
    for (const loan of this.activeLoans()) {
      const lentAt = new Date(loan.lentAt);
      const deadlineAt = loan.deadlineAt ? new Date(loan.deadlineAt) : null;
      for (const item of loan.items) {
        if (item.returnedAt) {
          continue;
        }
        views.push({
          rowKey: `${loan.id}-${item.id}`,
          loanId: loan.id,
          itemId: item.id,
          item,
          clientName: loan.clientName,
          phone: loan.phone,
          address: (loan.address ?? '').trim(),
          lentAt,
          hebrewLentDisplay: this.dateOnlyDisplay(loan.hebrewLentDisplay, lentAt),
          deadlineAt,
          returning: this.returningItemId() === item.id
        });
      }
    }
    const sorted = views.sort((a, b) => b.lentAt.getTime() - a.lentAt.getTime());
    const raw = this.activeSearchQuery().trim().toLowerCase();
    if (!raw) {
      return sorted;
    }
    const needleDigits = raw.replace(/\D/g, '');
    const needleText = raw.replace(/-/g, '').replace(/\s/g, '');
    return sorted.filter((row) => {
      const name = (row.clientName ?? '').toLowerCase().replace(/-/g, '').replace(/\s/g, '');
      const phoneDigits = (row.phone ?? '').replace(/\D/g, '');
      const nameHit = name.includes(needleText);
      const phoneHit = needleDigits.length > 0 && phoneDigits.includes(needleDigits);
      return nameHit || phoneHit;
    });
  });

  protected readonly activeCustomerCards = computed(() => {
    this.customers.customers();
    return this.buildActiveLoanCustomerCards(this.activeRows());
  });

  ngOnInit(): void {
    this.readRenewQueryParams();
    this.loadDefinitions();
    this.customers.load().subscribe();
    this.wireTimeLimitDays();
    this.wireActiveLoansSearch();
    this.wireCustomerSuggestDebounce();
    this.refreshActiveLoans();
    this.tryRestoreMinimizedDraft();
    interval(60_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.nowTick.set(Date.now()));
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest('[data-tool-suggest]') ||
      target?.closest('[data-codes-dropdown]') ||
      target?.closest('[data-customer-suggest]')
    ) {
      return;
    }
    this.closeToolUi();
    this.closeCustomerSuggest();
  }

  /** Global wedge scan when no input is focused — routes to return or loan. */
  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    const code = this.wedge.push(event);
    if (!code) {
      return;
    }
    if (this.formOpen()) {
      this.loanScanCode.set(code);
      this.applyLoanBarcodeScan(code);
      return;
    }
    this.quickReturnCode.set(code);
    this.submitQuickReturn();
  }

  protected addForm(): void {
    this.formOpen.set(true);
    this.loanScanCode.set('');
    if (this.forms().length === 0) {
      this.forms.set([this.createDraftForm()]);
    } else {
      // Reset to a fresh single draft when opening the panel.
      this.forms.set([this.createDraftForm()]);
    }
    // Use already-cached availability — no extra API call.
    queueMicrotask(() => this.focusLoanBarcodeField());
  }

  protected closeFormPanel(): void {
    this.formOpen.set(false);
    this.loanScanCode.set('');
    this.forms.set([this.createDraftForm()]);
    this.closeToolUi();
    this.closeCustomerSuggest();
    queueMicrotask(() => this.focusBarcodeField());
  }

  /** Keep the in-progress loan and return to the main lending board. */
  protected minimizeDraft(): void {
    const current = this.forms();
    const clientName = current[0]?.clientName?.trim() ?? '';
    this.orderDraft.minimize({
      kind: 'library-loan',
      customerLabel: clientName,
      resumePath: '/library/lending',
      payload: {
        formsJson: JSON.stringify(current, (_key, value) =>
          value instanceof Date ? value.toISOString() : value
        ),
        timeLimitEnabled: this.timeLimitEnabled(),
        timeLimitValue: Number(this.timeLimitForm.controls.days.value) || 7
      }
    });
    this.formOpen.set(false);
    this.loanScanCode.set('');
    this.forms.set([this.createDraftForm()]);
    this.closeToolUi();
    this.closeCustomerSuggest();
    queueMicrotask(() => this.focusBarcodeField());
  }

  private tryRestoreMinimizedDraft(): void {
    const payload = this.orderDraft.takePendingRestore<WorkspaceLendingDraftPayload>('library-loan');
    if (!payload) {
      return;
    }
    try {
      const parsed = JSON.parse(payload.formsJson) as Array<Record<string, unknown>>;
      const revived: LendingDraftForm[] = parsed.map((raw) => ({
        id: String(raw['id'] ?? `draft-${Date.now()}`),
        createdAt: new Date(String(raw['createdAt'] ?? Date.now())),
        hebrewDateTime: String(raw['hebrewDateTime'] ?? ''),
        bookLines: Array.isArray(raw['bookLines'])
          ? (raw['bookLines'] as BookLineItem[]).map((line) => ({
              ...line,
              bookSuggestOpen: false,
              copiesOpen: false
            }))
          : [this.createToolLine()],
        clientName: String(raw['clientName'] ?? ''),
        phone: String(raw['phone'] ?? ''),
        phone2: String(raw['phone2'] ?? ''),
        address: String(raw['address'] ?? ''),
        deposit: String(raw['deposit'] ?? ''),
        notes: String(raw['notes'] ?? ''),
        clientAlertNotes:
          typeof raw['clientAlertNotes'] === 'string' ? raw['clientAlertNotes'] : null,
        deadlineAt: raw['deadlineAt'] ? new Date(String(raw['deadlineAt'])) : null
      }));
      this.timeLimitEnabled.set(payload.timeLimitEnabled === true);
      this.timeLimitForm.controls.days.setValue(payload.timeLimitValue || 7, { emitEvent: false });
      this.forms.set(revived.length > 0 ? revived : [this.createDraftForm()]);
      this.formOpen.set(true);
      this.loanScanCode.set('');
      queueMicrotask(() => this.focusLoanBarcodeField());
    } catch {
      this.toast.error('לא ניתן לשחזר את טיוטת ההשאלה');
    }
  }

  protected onQuickReturnToolChange(bookId: number | null): void {
    this.quickReturnToolId.set(bookId != null && bookId > 0 ? bookId : null);
    this.quickReturnCode.set('');
  }

  protected onQuickReturnCodeInput(value: string): void {
    this.quickReturnCode.set(value);
  }

  protected onQuickReturnChargeInput(value: string): void {
    this.quickReturnCharge.set(value);
  }

  protected onRowChargeInput(itemId: number, value: string): void {
    this.rowCharges.update((m) => ({ ...m, [itemId]: value }));
  }

  protected rowChargeValue(itemId: number): string {
    return this.rowCharges()[itemId] ?? '';
  }

  private parseCharge(raw: string | undefined | null): number | null {
    const trimmed = (raw ?? '').trim();
    if (!trimmed) {
      return null;
    }
    const n = Number(trimmed.replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) {
      return null;
    }
    return n;
  }

  /** Enter from scanner (or keyboard) on the focused barcode field. */
  protected onQuickReturnKeydownEnter(event: Event): void {
    event.preventDefault();
    this.submitQuickReturn();
  }

  protected submitQuickReturn(): void {
    if (this.quickReturning()) {
      return;
    }

    const serial = this.quickReturnCode().trim();
    if (!serial) {
      this.toast.error('יש להזין ברקוד');
      this.focusBarcodeField();
      return;
    }

    let bookId = this.quickReturnToolId();
    if (bookId == null) {
      const resolved = this.resolveActiveLoanByCopy(serial);
      if (!resolved) {
        return;
      }
      bookId = resolved.bookId;
      this.quickReturnToolId.set(bookId);
    }

    const matched = this.activeRows().find(
      (r) =>
        r.item.bookId === bookId &&
        r.item.copyNumber.toLowerCase() === serial.toLowerCase()
    );
    const charge =
      this.parseCharge(matched ? this.rowChargeValue(matched.itemId) : null) ??
      this.parseCharge(this.quickReturnCharge());

    const hebrew = this.formatHebrewDate(new Date());
    this.quickReturning.set(true);
    this.data
      .returnBookLoanByCode({
        bookId: bookId,
        copyNumber: serial,
        hebrewReturnedDisplay: hebrew,
        chargeAmount: charge && charge > 0 ? charge : null
      })
      .pipe(finalize(() => this.quickReturning.set(false)))
      .subscribe((updated) => {
        if (!updated) {
          this.quickReturnCode.set('');
          this.focusBarcodeField();
          return;
        }
        this.toast.success('ההחזרה נרשמה');
        this.quickReturnCode.set('');
        this.quickReturnCharge.set('');
        if (matched) {
          this.rowCharges.update((m) => {
            const next = { ...m };
            delete next[matched.itemId];
            return next;
          });
        }
        this.refreshActiveLoans();
        this.refreshAvailability();
        this.focusBarcodeField();
      });
  }

  protected onLoanScanCodeInput(value: string): void {
    this.loanScanCode.set(value);
  }

  /** Enter on the loan-form barcode field — add the scanned copy to the draft. */
  protected onLoanBarcodeKeydownEnter(event: Event): void {
    event.preventDefault();
    const code = this.loanScanCode().trim();
    if (!code) {
      return;
    }
    this.applyLoanBarcodeScan(code);
  }

  /**
   * Resolve a scanned copy among available stock and select it on the open loan draft.
   * Clears the scan field and re-focuses for the next wedge.
   */
  private applyLoanBarcodeScan(rawCode: string): void {
    const code = rawCode.trim();
    if (!code) {
      return;
    }

    const hit = this.findAvailableCopy(code);
    if (!hit) {
      this.toast.error(`ברקוד ${code} אינו זמין להשאלה`);
      this.loanScanCode.set('');
      this.focusLoanBarcodeField();
      return;
    }

    const forms = this.forms();
    const form = forms[0];
    if (!form) {
      return;
    }

    const already = form.bookLines.some((l) =>
      l.selectedCopies.some((c) => c.toLowerCase() === hit.copyNumber.toLowerCase())
    );
    if (already) {
      this.toast.error(`ברקוד ${hit.copyNumber} כבר נבחר`);
      this.loanScanCode.set('');
      this.focusLoanBarcodeField();
      return;
    }

    const lineWithBook = form.bookLines.find((l) => l.bookId === hit.bookId);
    if (lineWithBook) {
      this.forms.update((list) =>
        list.map((f) =>
          f.id !== form.id
            ? f
            : {
                ...f,
                bookLines: f.bookLines.map((l) =>
                  l.id !== lineWithBook.id
                    ? l
                    : {
                        ...l,
                        selectedCopies: [...l.selectedCopies, hit.copyNumber]
                      }
                )
              }
        )
      );
    } else {
      const emptyLine = form.bookLines.find(
        (l) => l.bookId == null && l.selectedCopies.length === 0
      );
      const book = this.definitions().find((d) => d.id === hit.bookId);
      if (!book) {
        this.toast.error('הספר לא נמצא');
        this.loanScanCode.set('');
        this.focusLoanBarcodeField();
        return;
      }

      if (emptyLine) {
        this.forms.update((list) =>
          list.map((f) =>
            f.id !== form.id
              ? f
              : {
                  ...f,
                  bookLines: f.bookLines.map((l) =>
                    l.id !== emptyLine.id
                      ? l
                      : {
                          ...l,
                          bookId: book.id,
                          bookQuery: book.title,
                          selectedCopies: [hit.copyNumber],
                          bookSuggestOpen: false,
                          copiesOpen: false
                        }
                  )
                }
          )
        );
      } else {
        this.forms.update((list) =>
          list.map((f) =>
            f.id !== form.id
              ? f
              : {
                  ...f,
                  bookLines: [
                    ...f.bookLines,
                    {
                      ...this.createToolLine(),
                      bookId: book.id,
                      bookQuery: book.title,
                      selectedCopies: [hit.copyNumber]
                    }
                  ]
                }
          )
        );
      }
    }

    this.toast.success(`נוסף: ${hit.copyNumber}`);
    this.loanScanCode.set('');
    this.focusLoanBarcodeField();
  }

  /** Match barcode to a currently active (unreturned) loan item. */
  private resolveActiveLoanByCopy(serial: string): { bookId: number } | null {
    const needle = serial.toLowerCase();
    const matches = this.activeRows().filter(
      (r) => r.item.copyNumber.toLowerCase() === needle
    );
    if (matches.length === 1) {
      return { bookId: matches[0].item.bookId };
    }
    if (matches.length === 0) {
      this.toast.error('הברקוד אינו מסומן כמושאל כרגע');
      this.focusBarcodeField();
      return null;
    }
    this.toast.error('נמצאו מספר התאמות — בחרו ספר');
    this.focusBarcodeField();
    return null;
  }

  private findAvailableCopy(
    code: string
  ): { bookId: number; copyNumber: string } | null {
    const needle = code.toLowerCase();
    const hits: { bookId: number; copyNumber: string }[] = [];
    for (const [bookId, copies] of this.availableByBook()) {
      for (const copy of copies) {
        if (copy.toLowerCase() === needle) {
          hits.push({ bookId, copyNumber: copy });
        }
      }
    }
    return hits.length === 1 ? hits[0] : null;
  }

  private focusBarcodeField(): void {
    queueMicrotask(() => this.focusAndSelect(this.barcodeField()?.nativeElement));
  }

  private focusLoanBarcodeField(): void {
    queueMicrotask(() => this.focusAndSelect(this.loanBarcodeField()?.nativeElement));
  }

  /** Focus + select so the next wedge scan replaces any leftover text. */
  private focusAndSelect(el: HTMLInputElement | undefined): void {
    if (!el) {
      return;
    }
    el.focus();
    el.select();
  }

  protected refreshActiveLoans(): void {
    this.activeLoading.set(true);
    this.data
      .getActiveBookLoans()
      .pipe(finalize(() => this.activeLoading.set(false)))
      .subscribe((list) => {
        this.activeLoans.set(list);
      });
  }

  protected formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
  }

  protected durationText(row: ActiveLoanRowView): string {
    const days = libraryBillableDays(row.lentAt, new Date(this.nowTick()));
    return formatLibraryDuration(days, this.isOverdue(row));
  }

  protected isOverdue(row: ActiveLoanRowView): boolean {
    if (!row.deadlineAt) {
      return false;
    }
    return new Date(this.nowTick()).getTime() > endOfLocalDay(row.deadlineAt).getTime();
  }

  protected onReturnedToggle(row: ActiveLoanRowView, checked: boolean): void {
    if (!checked) {
      return;
    }
    if (this.returningCustomerKey() != null || this.returningItemId() != null) {
      return;
    }

    const stamp = new Date();
    const hebrew = this.formatHebrewDate(stamp);
    const charge = this.parseCharge(this.rowChargeValue(row.itemId));
    this.returningItemId.set(row.itemId);

    this.data
      .returnBookLoanItem(row.loanId, row.itemId, {
        hebrewReturnedDisplay: hebrew,
        chargeAmount: charge && charge > 0 ? charge : null
      })
      .pipe(finalize(() => this.returningItemId.set(null)))
      .subscribe((updated) => {
        if (!updated) {
          this.refreshActiveLoans();
          return;
        }
        this.toast.success('ההחזרה נרשמה');
        this.rowCharges.update((m) => {
          const next = { ...m };
          delete next[row.itemId];
          return next;
        });
        this.refreshActiveLoans();
        this.refreshAvailability();
      });
  }

  protected isReturningCustomer(card: ActiveLoanCustomerCard): boolean {
    return this.returningCustomerKey() === card.key;
  }

  protected isCardBusy(card: ActiveLoanCustomerCard): boolean {
    if (this.isReturningCustomer(card)) {
      return true;
    }
    const itemId = this.returningItemId();
    return itemId != null && card.items.some((row) => row.itemId === itemId);
  }

  protected cardTotalCharge(card: ActiveLoanCustomerCard): number {
    this.rowCharges();
    let sum = 0;
    for (const row of card.items) {
      const charge = this.parseCharge(this.rowChargeValue(row.itemId));
      if (charge != null) {
        sum += charge;
      }
    }
    return sum;
  }

  protected formatChargeTotal(amount: number): string {
    const rounded = Math.round(amount * 100) / 100;
    return Number.isInteger(rounded) ? `₪${rounded}` : `₪${rounded.toFixed(2)}`;
  }

  protected markCustomerAllReturned(card: ActiveLoanCustomerCard): void {
    if (this.returningCustomerKey() != null || this.returningItemId() != null || card.items.length === 0) {
      return;
    }

    const hebrew = this.formatHebrewDate(new Date());
    const requests = card.items.map((row) => {
      const charge = this.parseCharge(this.rowChargeValue(row.itemId));
      return this.data.returnBookLoanItem(row.loanId, row.itemId, {
        hebrewReturnedDisplay: hebrew,
        chargeAmount: charge && charge > 0 ? charge : null
      });
    });

    this.returningCustomerKey.set(card.key);
    forkJoin(requests)
      .pipe(finalize(() => this.returningCustomerKey.set(null)))
      .subscribe((results) => {
        const okCount = results.filter((r) => !!r).length;
        if (okCount === 0) {
          this.refreshActiveLoans();
          return;
        }
        this.toast.success(
          card.items.length === 1
            ? 'הספר סומן כהוחזר'
            : `${okCount} ספרים סומנו כהוחזרו`
        );
        this.rowCharges.update((m) => {
          const next = { ...m };
          for (const row of card.items) {
            delete next[row.itemId];
          }
          return next;
        });
        this.refreshActiveLoans();
        this.refreshAvailability();
      });
  }

  private customerCardKey(row: Pick<ActiveLoanRowView, 'clientName' | 'phone'>): string {
    return `${(row.clientName ?? '').trim()}|${(row.phone ?? '').replace(/\D/g, '')}`;
  }

  private buildActiveLoanCustomerCards(rows: ActiveLoanRowView[]): ActiveLoanCustomerCard[] {
    const byCustomer = new Map<string, ActiveLoanCustomerCard>();

    for (const row of rows) {
      const key = this.customerCardKey(row);
      let card = byCustomer.get(key);
      if (!card) {
        card = {
          key,
          customerName: row.clientName,
          phone: row.phone,
          address: row.address,
          customerNotes: this.customers.notesForPhone(row.phone),
          items: []
        };
        byCustomer.set(key, card);
      }
      if (!card.address && row.address) {
        card.address = row.address;
      }
      if (!card.customerNotes) {
        card.customerNotes = this.customers.notesForPhone(row.phone);
      }
      card.items.push(row);
    }

    return [...byCustomer.values()].sort((a, b) => {
      const nameCmp = a.customerName.localeCompare(b.customerName, 'he');
      if (nameCmp !== 0) {
        return nameCmp;
      }
      return a.phone.localeCompare(b.phone, 'he');
    });
  }

  protected removeForm(formId: string): void {
    this.forms.update((list) => (list.length <= 1 ? list : list.filter((f) => f.id !== formId)));
  }

  protected addToolLine(formId: string): void {
    this.forms.update((list) =>
      list.map((f) =>
        f.id !== formId
          ? f
          : { ...f, bookLines: [...f.bookLines, this.createToolLine()] }
      )
    );
  }

  protected removeToolLine(formId: string, lineId: string): void {
    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        const next = f.bookLines.filter((l) => l.id !== lineId);
        return { ...f, bookLines: next.length > 0 ? next : [this.createToolLine()] };
      })
    );
  }

  protected toggleTimeLimit(): void {
    const next = !this.timeLimitEnabled();
    this.timeLimitEnabled.set(next);
    if (next) {
      this.recomputeAllDeadlines();
    } else {
      this.forms.update((list) => list.map((f) => ({ ...f, deadlineAt: null })));
    }
  }

  protected filteredToolsForLine(form: LendingDraftForm, line: BookLineItem): BookDto[] {
    const q = line.bookQuery.trim().toLowerCase();
    const usedElsewhere = new Set(
      form.bookLines
        .filter((l) => l.id !== line.id && l.bookId != null)
        .map((l) => l.bookId as number)
    );
    return this.definitions().filter((d) => {
      if (usedElsewhere.has(d.id) && d.id !== line.bookId) {
        return false;
      }
      if (!q) {
        return true;
      }
      return d.title.toLowerCase().includes(q);
    });
  }

  protected availableCodesForLine(_form: LendingDraftForm, line: BookLineItem): string[] {
    if (line.bookId == null) {
      return [];
    }
    // Local filter only — from the single bulk cache loaded at page init.
    const inStock = this.availableByBook().get(line.bookId) ?? [];
    return [...inStock].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }

  protected onToolQueryInput(formId: string, lineId: string, value: string): void {
    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        return {
          ...f,
          bookLines: f.bookLines.map((l) =>
            l.id !== lineId
              ? { ...l, bookSuggestOpen: false, copiesOpen: false }
              : {
                  ...l,
                  bookQuery: value,
                  bookId: null,
                  selectedCopies: [],
                  bookSuggestOpen: true,
                  copiesOpen: false
                }
          )
        };
      })
    );
    this.closeCustomerSuggest();
  }

  protected onToolQueryFocus(formId: string, lineId: string): void {
    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        return {
          ...f,
          bookLines: f.bookLines.map((l) => ({
            ...l,
            bookSuggestOpen: l.id === lineId,
            copiesOpen: false
          }))
        };
      })
    );
    this.closeCustomerSuggest();
  }

  protected selectTool(formId: string, lineId: string, tool: BookDto): void {
    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        return {
          ...f,
          bookLines: f.bookLines.map((l) =>
            l.id !== lineId
              ? l
              : {
                  ...l,
                  bookId: tool.id,
                  bookQuery: tool.title,
                  selectedCopies: [],
                  bookSuggestOpen: false,
                  copiesOpen: false
                }
          )
        };
      })
    );
  }

  protected toggleCodesDropdown(formId: string, lineId: string, event: Event): void {
    event.stopPropagation();
    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        return {
          ...f,
          bookLines: f.bookLines.map((l) => ({
            ...l,
            copiesOpen: l.id === lineId ? !l.copiesOpen : false,
            bookSuggestOpen: false
          }))
        };
      })
    );
    this.closeCustomerSuggest();
  }

  protected toggleCodeSelection(formId: string, lineId: string, code: string, event: Event): void {
    event.stopPropagation();
    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        return {
          ...f,
          bookLines: f.bookLines.map((l) => {
            if (l.id !== lineId) {
              return l;
            }
            const selected = l.selectedCopies.includes(code)
              ? l.selectedCopies.filter((c) => c !== code)
              : [...l.selectedCopies, code];
            return { ...l, selectedCopies: selected };
          })
        };
      })
    );
  }

  protected patchForm(
    formId: string,
    patch: Partial<
      Pick<
        LendingDraftForm,
        'clientName' | 'phone' | 'phone2' | 'address' | 'deposit' | 'notes' | 'clientAlertNotes'
      >
    >
  ): void {
    this.forms.update((list) => list.map((f) => (f.id === formId ? { ...f, ...patch } : f)));
  }

  protected onClientNameInput(formId: string, value: string): void {
    this.patchForm(formId, { clientName: value, clientAlertNotes: null });
    this.openCustomerSuggest(formId, 'name', value);
  }

  protected onPhoneInput(formId: string, value: string): void {
    const digits = clampIsraeliPhoneDigits(value);
    this.patchForm(formId, { phone: digits, clientAlertNotes: null });
    this.openCustomerSuggest(formId, 'phone', digits);
    if (digits.length >= 9) {
      this.lookupClientNotesByPhone(formId, digits);
    }
  }

  protected onPhone2Input(formId: string, value: string): void {
    const digits = clampIsraeliPhoneDigits(value);
    this.patchForm(formId, { phone2: digits });
  }

  protected onAddressInput(formId: string, value: string): void {
    this.patchForm(formId, { address: value });
  }

  protected selectCustomerSuggestion(formId: string, customer: CustomerSuggestDto): void {
    this.patchForm(formId, {
      clientName: customer.fullName ?? '',
      phone: customer.phone1,
      phone2: customer.phone2 ?? '',
      address: customer.address ?? ''
    });
    this.closeCustomerSuggest();
    this.lookupClientNotesByPhone(formId, customer.phone1);
  }

  protected dismissClientAlert(formId: string): void {
    this.patchForm(formId, { clientAlertNotes: null });
  }

  protected closeCustomerSuggest(): void {
    this.customerSuggestOpen.set(false);
    this.customerSuggestField.set(null);
    this.customerSuggestFormId.set(null);
  }

  protected formatDeadline(deadline: Date | null): string {
    if (!deadline) {
      return '—';
    }
    return this.formatHebrewDate(deadline);
  }

  protected submitForm(form: LendingDraftForm): void {
    const items = this.buildLoanItems(form);
    if (!items) {
      return;
    }
    if (!form.phone.trim()) {
      this.toast.error('יש להזין מספר טלפון');
      return;
    }
    if (!isValidIsraeliPhone(form.phone.trim())) {
      this.toast.error(ISRAELI_PHONE_INVALID_MESSAGE);
      return;
    }
    if (form.phone2.trim() && !isValidIsraeliPhone(form.phone2.trim())) {
      this.toast.error(ISRAELI_PHONE_INVALID_MESSAGE);
      return;
    }

    const payload: BookLoanCreateDto = {
      clientName: form.clientName.trim(),
      phone: form.phone.trim(),
      phone2: form.phone2.trim() || null,
      address: form.address.trim() || null,
      deposit: form.deposit.trim() || null,
      notes: form.notes.trim() || null,
      hebrewLentDisplay: form.hebrewDateTime,
      deadlineAt: this.timeLimitEnabled() && form.deadlineAt ? form.deadlineAt.toISOString() : null,
      items
    };

    this.submittingId.set(form.id);
    this.data
      .createBookLoan(payload)
      .pipe(finalize(() => this.submittingId.set(null)))
      .subscribe((created) => {
        if (!created) {
          return;
        }
        const address = form.address.trim() || null;
        const phone2 = form.phone2.trim() || null;
        this.customers.upsertFromPayload({
          phone1: payload.phone,
          phone2,
          fullName: payload.clientName || null,
          address,
          systemType: SystemType.Library
        });
        this.data
          .upsertCustomer({
            phone1: payload.phone,
            phone2,
            fullName: payload.clientName || null,
            address,
            systemType: SystemType.Library
          })
          .subscribe((saved) => {
            if (saved) {
              this.customers.upsert(saved);
            }
          });
        this.toast.success('ההשאלה נשמרה');
        this.orderDraft.clearIfKind('library-loan');
        this.formOpen.set(false);
        this.loanScanCode.set('');
        this.forms.set([this.createDraftForm()]);
        this.refreshAvailability();
        this.refreshActiveLoans();
        this.focusBarcodeField();
      });
  }

  private applyClientNotesAlert(formId: string, notes: string | null | undefined): void {
    const trimmed = (notes ?? '').trim();
    if (!trimmed) {
      this.patchForm(formId, { clientAlertNotes: null });
      return;
    }
    this.patchForm(formId, { clientAlertNotes: trimmed });
    this.toast.error(`התראת לקוח: ${trimmed}`);
  }

  private lookupClientNotesByPhone(formId: string, phone: string): void {
    this.customers.searchGlobal(phone).subscribe((hits) => {
      const match = hits.find((c) => c.phone1 === phone);
      if (match) {
        this.applyClientNotesAlert(formId, match.notes);
      }
    });
  }

  private closeToolUi(): void {
    this.forms.update((list) =>
      list.map((f) => ({
        ...f,
        bookLines: f.bookLines.map((l) => ({
          ...l,
          bookSuggestOpen: false,
          copiesOpen: false
        }))
      }))
    );
  }

  private buildLoanItems(form: LendingDraftForm): BookLoanCreateDto['items'] | null {
    const items: BookLoanCreateDto['items'] = [];
    const seenCodes = new Set<string>();

    for (const line of form.bookLines) {
      if (line.bookId == null) {
        if (line.bookQuery.trim() || line.selectedCopies.length > 0) {
          this.toast.error('יש לבחור ספר מרשימת ההשלמה בכל שורה');
          return null;
        }
        continue;
      }
      if (line.selectedCopies.length === 0) {
        this.toast.error(`יש לבחור לפחות ברקוד עבור ${line.bookQuery || 'הספר שנבחר'}`);
        return null;
      }
      for (const code of line.selectedCopies) {
        const key = code.toLowerCase();
        if (seenCodes.has(key)) {
          this.toast.error(`ברקוד ${code} נבחר יותר מפעם אחת`);
          return null;
        }
        seenCodes.add(key);
        items.push({ bookId: line.bookId, copyNumber: code });
      }
    }

    if (items.length === 0) {
      this.toast.error('יש להוסיף לפחות ספר אחד עם ברקוד');
      return null;
    }
    return items;
  }

  private wireCustomerSuggestDebounce(): void {
    this.customerSuggestQuery$
      .pipe(
        debounceTime(300),
        switchMap(({ formId, field, q }) => {
          const trimmed = q.trim();
          if (trimmed.length < 2) {
            this.closeCustomerSuggest();
            this.customerSuggestions.set([]);
            return EMPTY;
          }
          return this.customers.searchSuggest(trimmed).pipe(
            map((hits) => ({ formId, field, hits }))
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ formId, field, hits }) => {
        if (this.customerSuggestFormId() !== formId) {
          return;
        }
        this.customerSuggestField.set(field);
        this.customerSuggestions.set(hits.slice(0, 8));
        this.customerSuggestOpen.set(hits.length > 0);
      });
  }

  private openCustomerSuggest(formId: string, field: 'name' | 'phone', q: string): void {
    this.customerSuggestFormId.set(formId);
    this.customerSuggestField.set(field);
    this.closeToolUi();
    this.customerSuggestQuery$.next({ formId, field, q });
  }

  private loadDefinitions(): void {
    this.booksStore.load().subscribe(() => {
      this.tryApplyRenewPrefill();
    });
    // Exactly one availability request for the whole page (not per row/tool).
    this.refreshAvailability();
  }

  private readRenewQueryParams(): void {
    const qp = this.route.snapshot.queryParamMap;
    const phone = (qp.get('renewPhone') ?? '').trim();
    const bookId = Number(qp.get('bookId'));
    const copyNumber = (qp.get('copyNumber') ?? '').trim();
    if (!phone || !Number.isFinite(bookId) || bookId <= 0 || !copyNumber) {
      return;
    }

    this.pendingRenew = {
      phone,
      clientName: (qp.get('renewName') ?? '').trim(),
      phone2: (qp.get('renewPhone2') ?? '').trim(),
      address: (qp.get('renewAddress') ?? '').trim(),
      bookId,
      copyNumber
    };
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {},
      replaceUrl: true
    });
  }

  private tryApplyRenewPrefill(): void {
    const pending = this.pendingRenew;
    if (!pending) {
      return;
    }

    const def = this.definitions().find((d) => d.id === pending.bookId);
    if (!def) {
      this.pendingRenew = null;
      this.toast.error('הספר לא נמצא במלאי');
      return;
    }

    this.pendingRenew = null;
    const draft = this.createDraftForm();
    draft.clientName = pending.clientName;
    draft.phone = pending.phone;
    draft.phone2 = pending.phone2;
    draft.address = pending.address;
    draft.bookLines = [
      {
        id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        bookId: def.id,
        bookQuery: def.title,
        selectedCopies: [pending.copyNumber],
        bookSuggestOpen: false,
        copiesOpen: false
      }
    ];
    this.forms.set([draft]);
    this.formOpen.set(true);
    if (pending.phone.replace(/\D/g, '').length >= 9) {
      this.lookupClientNotesByPhone(draft.id, pending.phone.replace(/\D/g, ''));
    }
  }

  private refreshAvailability(): void {
    this.data.getAllAvailableBookCopies().subscribe((groups) => {
      const map = new Map<number, string[]>();
      for (const group of groups) {
        map.set(group.bookId, group.copies ?? []);
      }
      this.availableByBook.set(map);
    });
  }

  private wireTimeLimitDays(): void {
    this.timeLimitForm.controls.days.valueChanges
      .pipe(debounceTime(150), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.timeLimitEnabled()) {
          this.recomputeAllDeadlines();
        }
      });
  }

  /** Debounced local filter only — no HTTP while typing. */
  private wireActiveLoansSearch(): void {
    this.activeSearchInput.valueChanges
      .pipe(debounceTime(150), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((q) => this.activeSearchQuery.set(q));
  }

  private recomputeAllDeadlines(): void {
    const days = Number(this.timeLimitForm.controls.days.value) || 0;
    this.forms.update((list) =>
      list.map((f) => ({
        ...f,
        deadlineAt: this.computeDeadline(f.createdAt, days)
      }))
    );
  }

  private isTimeLimitEnabled(): boolean {
    const sig = this.timeLimitEnabled;
    return typeof sig === 'function' ? sig() : false;
  }

  private computeDeadline(lentAt: Date, days: number): Date | null {
    if (!this.isTimeLimitEnabled() || days <= 0) {
      return null;
    }
    return addDaysToDate(lentAt, days);
  }

  private createToolLine(): BookLineItem {
    return {
      id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      bookId: null,
      bookQuery: '',
      selectedCopies: [],
      bookSuggestOpen: false,
      copiesOpen: false
    };
  }

  private createDraftForm(): LendingDraftForm {
    const createdAt = new Date();
    const days = Number(this.timeLimitForm?.controls.days.value) || 7;
    const timeLimitOn = this.isTimeLimitEnabled();
    return {
      id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt,
      hebrewDateTime: this.formatHebrewDate(createdAt),
      bookLines: [this.createToolLine()],
      clientName: '',
      phone: '',
      phone2: '',
      address: '',
      deposit: '',
      notes: '',
      clientAlertNotes: null,
      deadlineAt: timeLimitOn ? this.computeDeadline(createdAt, days) : null
    };
  }

  /** Strip any stored time suffix and show Hebrew date only. */
  private dateOnlyDisplay(stored: string | null | undefined, date: Date): string {
    const trimmed = (stored ?? '').trim();
    if (trimmed) {
      // Stored value may be "עברית HH:MM" from older Tools-style stamps — keep the date words only.
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
