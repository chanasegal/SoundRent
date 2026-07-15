import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize, interval } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { CustomerDto } from '../../core/models/customer.model';
import { SystemType } from '../../core/models/enums';
import {
  BookDto,
  BookLoanCreateDto,
  BookLoanDto,
  BookLoanItemDto
} from '../../core/models/library-workspace.model';
import { CustomersStore } from '../../core/services/customers.store';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import {
  addDaysToDate,
  endOfLocalDay,
  formatLibraryDuration,
  libraryBillableDays
} from '../../core/utils/library-loan-duration';
import { BookTitleSelectComponent } from '../../shared/components/book-title-select.component';

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
  lentAt: Date;
  hebrewLentDisplay: string;
  deadlineAt: Date | null;
  returning: boolean;
}

@Component({
  selector: 'app-library-lending',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, BookTitleSelectComponent],
  templateUrl: './library-lending.component.html',
  styleUrl: './library-lending.component.scss'
})
export class LibraryLendingComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly customers = inject(CustomersStore);
  private readonly hebrew = inject(HebrewDateService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly pageTitle = inject(WorkspaceUiService).title('לוח השאלות');

  protected readonly definitions = signal<BookDto[]>([]);
  protected readonly availableByBook = signal<Map<number, string[]>>(new Map());
  protected readonly submittingId = signal<string | null>(null);
  /** Declared before `forms` — `createDraftForm()` reads this during field init. */
  protected readonly timeLimitEnabled = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly activeLoading = signal(true);
  protected readonly activeLoans = signal<BookLoanDto[]>([]);
  protected readonly returningItemId = signal<number | null>(null);
  protected readonly nowTick = signal(Date.now());
  protected readonly customerSuggestions = signal<CustomerDto[]>([]);
  protected readonly customerSuggestOpen = signal(false);
  protected readonly customerSuggestField = signal<'name' | 'phone' | 'address' | null>(null);
  protected readonly customerSuggestFormId = signal<string | null>(null);

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

  ngOnInit(): void {
    this.loadDefinitions();
    this.wireTimeLimitDays();
    this.wireActiveLoansSearch();
    this.refreshActiveLoans();
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

  protected addForm(): void {
    this.formOpen.set(true);
    if (this.forms().length === 0) {
      this.forms.set([this.createDraftForm()]);
    } else {
      // Reset to a fresh single draft when opening the panel.
      this.forms.set([this.createDraftForm()]);
    }
    // Use already-cached availability — no extra API call.
  }

  protected closeFormPanel(): void {
    this.formOpen.set(false);
    this.forms.set([this.createDraftForm()]);
    this.closeToolUi();
    this.closeCustomerSuggest();
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

  protected submitQuickReturn(): void {
    const bookId = this.quickReturnToolId();
    const serial = this.quickReturnCode().trim();
    if (bookId == null) {
      this.toast.error('יש לבחור ספר');
      return;
    }
    if (!serial) {
      this.toast.error('יש להזין ברקוד');
      return;
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
      });
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
        'clientName' | 'phone' | 'address' | 'deposit' | 'notes' | 'clientAlertNotes'
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
    const digits = value.replace(/\D/g, '').slice(0, 10);
    this.patchForm(formId, { phone: digits, clientAlertNotes: null });
    this.openCustomerSuggest(formId, 'phone', digits);
    if (digits.length >= 9) {
      this.lookupClientNotesByPhone(formId, digits);
    }
  }

  protected onAddressInput(formId: string, value: string): void {
    this.patchForm(formId, { address: value });
    this.openCustomerSuggest(formId, 'address', value);
  }

  protected selectCustomerSuggestion(formId: string, customer: CustomerDto): void {
    this.patchForm(formId, {
      clientName: customer.fullName ?? '',
      phone: customer.phone1,
      address: customer.address ?? ''
    });
    this.applyClientNotesAlert(formId, customer.notes);
    this.closeCustomerSuggest();
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

    const payload: BookLoanCreateDto = {
      clientName: form.clientName.trim(),
      phone: form.phone.trim(),
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
        this.customers.upsertFromPayload({
          phone1: payload.phone,
          fullName: payload.clientName || null,
          address,
          systemType: SystemType.Library
        });
        this.data
          .upsertCustomer({
            phone1: payload.phone,
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
        this.formOpen.set(false);
        this.forms.set([this.createDraftForm()]);
        this.refreshAvailability();
        this.refreshActiveLoans();
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

  private openCustomerSuggest(
    formId: string,
    field: 'name' | 'phone' | 'address',
    q: string
  ): void {
    this.customerSuggestFormId.set(formId);
    this.customerSuggestField.set(field);
    this.closeToolUi();
    this.customers.searchGlobal(q).subscribe((hits) => {
      this.customerSuggestions.set(hits.slice(0, 8));
      this.customerSuggestOpen.set(hits.length > 0);
    });
  }

  private loadDefinitions(): void {
    this.data.getBooks().subscribe((list) => {
      this.definitions.set(list);
    });
    // Exactly one availability request for the whole page (not per row/tool).
    this.refreshAvailability();
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
