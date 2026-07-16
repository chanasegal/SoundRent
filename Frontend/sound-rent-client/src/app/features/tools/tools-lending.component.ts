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
import { ActivatedRoute, Router } from '@angular/router';
import { finalize, interval } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { CustomerDto } from '../../core/models/customer.model';
import { SystemType } from '../../core/models/enums';
import {
  ToolDefinitionDto,
  ToolLoanCreateDto,
  ToolLoanDto,
  ToolLoanItemDto
} from '../../core/models/tools-workspace.model';
import { CustomersStore } from '../../core/services/customers.store';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import {
  formatBillableDuration,
  toBillableParts
} from '../../core/utils/tools-billable-duration';
import { ToolTypeSelectComponent } from '../../shared/components/tool-type-select.component';

interface ToolLineItem {
  id: string;
  toolId: number | null;
  toolQuery: string;
  selectedCodes: string[];
  toolSuggestOpen: boolean;
  codesOpen: boolean;
}

interface LendingDraftForm {
  id: string;
  createdAt: Date;
  hebrewDateTime: string;
  toolLines: ToolLineItem[];
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
  item: ToolLoanItemDto;
  clientName: string;
  phone: string;
  lentAt: Date;
  hebrewLentDisplay: string;
  deadlineAt: Date | null;
  returning: boolean;
}

@Component({
  selector: 'app-tools-lending',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, ToolTypeSelectComponent],
  templateUrl: './tools-lending.component.html',
  styleUrl: './tools-lending.component.scss'
})
export class ToolsLendingComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly customers = inject(CustomersStore);
  private readonly hebrew = inject(HebrewDateService);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly pageTitle = inject(WorkspaceUiService).title('לוח השאלות');

  private pendingRenew: {
    phone: string;
    clientName: string;
    phone2: string;
    address: string;
    toolId: number;
    serialCode: string;
  } | null = null;

  protected readonly definitions = signal<ToolDefinitionDto[]>([]);
  protected readonly availableByTool = signal<Map<number, string[]>>(new Map());
  protected readonly submittingId = signal<string | null>(null);
  /** Declared before `forms` — `createDraftForm()` reads this during field init. */
  protected readonly timeLimitEnabled = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly activeLoading = signal(true);
  protected readonly activeLoans = signal<ToolLoanDto[]>([]);
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
    const toolId = this.quickReturnToolId();
    if (toolId == null) {
      return [] as string[];
    }
    const def = this.definitions().find((d) => d.id === toolId);
    return [...(def?.serialCodes ?? [])].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  });

  protected readonly timeLimitForm = this.fb.group({
    hours: [2, [Validators.required, Validators.min(0.25), Validators.max(168)]]
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
          hebrewLentDisplay: loan.hebrewLentDisplay || this.formatHebrewDateTime(lentAt),
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
    this.readRenewQueryParams();
    this.loadDefinitions();
    this.wireTimeLimitHours();
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

  protected onQuickReturnToolChange(toolId: number | null): void {
    this.quickReturnToolId.set(toolId != null && toolId > 0 ? toolId : null);
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
    const toolId = this.quickReturnToolId();
    const serial = this.quickReturnCode().trim();
    if (toolId == null) {
      this.toast.error('יש לבחור סוג כלי');
      return;
    }
    if (!serial) {
      this.toast.error('יש להזין קוד פריט');
      return;
    }

    const matched = this.activeRows().find(
      (r) =>
        r.item.toolDefinitionId === toolId &&
        r.item.serialCode.toLowerCase() === serial.toLowerCase()
    );
    const charge =
      this.parseCharge(matched ? this.rowChargeValue(matched.itemId) : null) ??
      this.parseCharge(this.quickReturnCharge());

    const hebrew = this.formatHebrewDateTime(new Date(), true);
    this.quickReturning.set(true);
    this.data
      .returnToolLoanByCode({
        toolDefinitionId: toolId,
        serialCode: serial,
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
      .getActiveToolLoans()
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
    return formatBillableDuration(toBillableParts(row.lentAt, new Date(this.nowTick())));
  }

  protected isOverdue(row: ActiveLoanRowView): boolean {
    if (!row.deadlineAt) {
      return false;
    }
    return new Date(this.nowTick()).getTime() > row.deadlineAt.getTime();
  }

  protected onReturnedToggle(row: ActiveLoanRowView, checked: boolean): void {
    if (!checked) {
      return;
    }

    const stamp = new Date();
    const hebrew = this.formatHebrewDateTime(stamp, true);
    const charge = this.parseCharge(this.rowChargeValue(row.itemId));
    this.returningItemId.set(row.itemId);

    this.data
      .returnToolLoanItem(row.loanId, row.itemId, {
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
          : { ...f, toolLines: [...f.toolLines, this.createToolLine()] }
      )
    );
  }

  protected removeToolLine(formId: string, lineId: string): void {
    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        const next = f.toolLines.filter((l) => l.id !== lineId);
        return { ...f, toolLines: next.length > 0 ? next : [this.createToolLine()] };
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

  protected filteredToolsForLine(form: LendingDraftForm, line: ToolLineItem): ToolDefinitionDto[] {
    const q = line.toolQuery.trim().toLowerCase();
    const usedElsewhere = new Set(
      form.toolLines
        .filter((l) => l.id !== line.id && l.toolId != null)
        .map((l) => l.toolId as number)
    );
    return this.definitions().filter((d) => {
      if (usedElsewhere.has(d.id) && d.id !== line.toolId) {
        return false;
      }
      if (!q) {
        return true;
      }
      return d.displayName.toLowerCase().includes(q);
    });
  }

  protected availableCodesForLine(_form: LendingDraftForm, line: ToolLineItem): string[] {
    if (line.toolId == null) {
      return [];
    }
    // Local filter only — from the single bulk cache loaded at page init.
    const inStock = this.availableByTool().get(line.toolId) ?? [];
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
          toolLines: f.toolLines.map((l) =>
            l.id !== lineId
              ? { ...l, toolSuggestOpen: false, codesOpen: false }
              : {
                  ...l,
                  toolQuery: value,
                  toolId: null,
                  selectedCodes: [],
                  toolSuggestOpen: true,
                  codesOpen: false
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
          toolLines: f.toolLines.map((l) => ({
            ...l,
            toolSuggestOpen: l.id === lineId,
            codesOpen: false
          }))
        };
      })
    );
    this.closeCustomerSuggest();
  }

  protected selectTool(formId: string, lineId: string, tool: ToolDefinitionDto): void {
    this.forms.update((list) =>
      list.map((f) => {
        if (f.id !== formId) {
          return f;
        }
        return {
          ...f,
          toolLines: f.toolLines.map((l) =>
            l.id !== lineId
              ? l
              : {
                  ...l,
                  toolId: tool.id,
                  toolQuery: tool.displayName,
                  selectedCodes: [],
                  toolSuggestOpen: false,
                  codesOpen: false
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
          toolLines: f.toolLines.map((l) => ({
            ...l,
            codesOpen: l.id === lineId ? !l.codesOpen : false,
            toolSuggestOpen: false
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
          toolLines: f.toolLines.map((l) => {
            if (l.id !== lineId) {
              return l;
            }
            const selected = l.selectedCodes.includes(code)
              ? l.selectedCodes.filter((c) => c !== code)
              : [...l.selectedCodes, code];
            return { ...l, selectedCodes: selected };
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
    const digits = value.replace(/\D/g, '').slice(0, 10);
    this.patchForm(formId, { phone: digits, clientAlertNotes: null });
    this.openCustomerSuggest(formId, 'phone', digits);
    if (digits.length >= 9) {
      this.lookupClientNotesByPhone(formId, digits);
    }
  }

  protected onPhone2Input(formId: string, value: string): void {
    const digits = value.replace(/\D/g, '').slice(0, 10);
    this.patchForm(formId, { phone2: digits });
  }

  protected onAddressInput(formId: string, value: string): void {
    this.patchForm(formId, { address: value });
    this.openCustomerSuggest(formId, 'address', value);
  }

  protected selectCustomerSuggestion(formId: string, customer: CustomerDto): void {
    this.patchForm(formId, {
      clientName: customer.fullName ?? '',
      phone: customer.phone1,
      phone2: customer.phone2 ?? '',
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
    const hh = String(deadline.getHours()).padStart(2, '0');
    const mm = String(deadline.getMinutes()).padStart(2, '0');
    return `${this.hebrew.toHebrew(deadline)} ${hh}:${mm}`;
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

    const payload: ToolLoanCreateDto = {
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
      .createToolLoan(payload)
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
          systemType: SystemType.Tools
        });
        this.data
          .upsertCustomer({
            phone1: payload.phone,
            phone2,
            fullName: payload.clientName || null,
            address,
            systemType: SystemType.Tools
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
        toolLines: f.toolLines.map((l) => ({
          ...l,
          toolSuggestOpen: false,
          codesOpen: false
        }))
      }))
    );
  }

  private buildLoanItems(form: LendingDraftForm): ToolLoanCreateDto['items'] | null {
    const items: ToolLoanCreateDto['items'] = [];
    const seenCodes = new Set<string>();

    for (const line of form.toolLines) {
      if (line.toolId == null) {
        if (line.toolQuery.trim() || line.selectedCodes.length > 0) {
          this.toast.error('יש לבחור כלי מרשימת ההשלמה בכל שורה');
          return null;
        }
        continue;
      }
      if (line.selectedCodes.length === 0) {
        this.toast.error(`יש לבחור לפחות קוד פריט עבור ${line.toolQuery || 'הכלי שנבחר'}`);
        return null;
      }
      for (const code of line.selectedCodes) {
        const key = code.toLowerCase();
        if (seenCodes.has(key)) {
          this.toast.error(`קוד פריט ${code} נבחר יותר מפעם אחת`);
          return null;
        }
        seenCodes.add(key);
        items.push({ toolDefinitionId: line.toolId, serialCode: code });
      }
    }

    if (items.length === 0) {
      this.toast.error('יש להוסיף לפחות כלי אחד עם קוד פריט');
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
    this.data.getToolDefinitions().subscribe((list) => {
      this.definitions.set(list);
      this.tryApplyRenewPrefill();
    });
    // Exactly one availability request for the whole page (not per row/tool).
    this.refreshAvailability();
  }

  private readRenewQueryParams(): void {
    const qp = this.route.snapshot.queryParamMap;
    const phone = (qp.get('renewPhone') ?? '').trim();
    const toolId = Number(qp.get('toolId'));
    const serialCode = (qp.get('serialCode') ?? '').trim();
    if (!phone || !Number.isFinite(toolId) || toolId <= 0 || !serialCode) {
      return;
    }

    this.pendingRenew = {
      phone,
      clientName: (qp.get('renewName') ?? '').trim(),
      phone2: (qp.get('renewPhone2') ?? '').trim(),
      address: (qp.get('renewAddress') ?? '').trim(),
      toolId,
      serialCode
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

    const def = this.definitions().find((d) => d.id === pending.toolId);
    if (!def) {
      this.pendingRenew = null;
      this.toast.error('הפריט לא נמצא במלאי');
      return;
    }

    this.pendingRenew = null;
    const draft = this.createDraftForm();
    draft.clientName = pending.clientName;
    draft.phone = pending.phone;
    draft.phone2 = pending.phone2;
    draft.address = pending.address;
    draft.toolLines = [
      {
        id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        toolId: def.id,
        toolQuery: def.displayName,
        selectedCodes: [pending.serialCode],
        toolSuggestOpen: false,
        codesOpen: false
      }
    ];
    this.forms.set([draft]);
    this.formOpen.set(true);
    if (pending.phone.replace(/\D/g, '').length >= 9) {
      this.lookupClientNotesByPhone(draft.id, pending.phone.replace(/\D/g, ''));
    }
  }

  private refreshAvailability(): void {
    this.data.getAllAvailableToolSerials().subscribe((groups) => {
      const map = new Map<number, string[]>();
      for (const group of groups) {
        map.set(group.toolDefinitionId, group.serialCodes ?? []);
      }
      this.availableByTool.set(map);
    });
  }

  private wireTimeLimitHours(): void {
    this.timeLimitForm.controls.hours.valueChanges
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
    const hours = Number(this.timeLimitForm.controls.hours.value) || 0;
    this.forms.update((list) =>
      list.map((f) => ({
        ...f,
        deadlineAt: this.computeDeadline(f.createdAt, hours)
      }))
    );
  }

  private isTimeLimitEnabled(): boolean {
    const sig = this.timeLimitEnabled;
    return typeof sig === 'function' ? sig() : false;
  }

  private computeDeadline(lentAt: Date, hours: number): Date | null {
    if (!this.isTimeLimitEnabled() || hours <= 0) {
      return null;
    }
    return new Date(lentAt.getTime() + hours * 3_600_000);
  }

  private createToolLine(): ToolLineItem {
    return {
      id: `line-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      toolId: null,
      toolQuery: '',
      selectedCodes: [],
      toolSuggestOpen: false,
      codesOpen: false
    };
  }

  private createDraftForm(): LendingDraftForm {
    const createdAt = new Date();
    const hours = Number(this.timeLimitForm?.controls.hours.value) || 2;
    const timeLimitOn = this.isTimeLimitEnabled();
    return {
      id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt,
      hebrewDateTime: this.formatHebrewDateTime(createdAt),
      toolLines: [this.createToolLine()],
      clientName: '',
      phone: '',
      phone2: '',
      address: '',
      deposit: '',
      notes: '',
      clientAlertNotes: null,
      deadlineAt: timeLimitOn ? this.computeDeadline(createdAt, hours) : null
    };
  }

  private formatHebrewDateTime(date: Date, withSeconds = false): string {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    if (withSeconds) {
      const ss = String(date.getSeconds()).padStart(2, '0');
      return `${this.hebrew.toHebrew(date)} ${hh}:${mm}:${ss}`;
    }
    return `${this.hebrew.toHebrew(date)} ${hh}:${mm}`;
  }
}
