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
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { finalize, forkJoin } from 'rxjs';
import { debounceTime, distinctUntilChanged, map } from 'rxjs/operators';

import { CustomerDto } from '../../core/models/customer.model';
import { SystemType } from '../../core/models/enums';
import { ToolDefinitionDto, ToolLoanCreateDto } from '../../core/models/tools-workspace.model';
import { CustomersStore } from '../../core/services/customers.store';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';

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
  address: string;
  deposit: string;
  notes: string;
  clientAlertNotes: string | null;
  deadlineAt: Date | null;
}

@Component({
  selector: 'app-tools-lending',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule],
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
  protected readonly pageTitle = inject(WorkspaceUiService).title('לוח השאלות');

  protected readonly definitions = signal<ToolDefinitionDto[]>([]);
  protected readonly availableByTool = signal<Map<number, string[]>>(new Map());
  protected readonly submittingId = signal<string | null>(null);
  /** Declared before `forms` — `createDraftForm()` reads this during field init. */
  protected readonly timeLimitEnabled = signal(false);
  protected readonly customerSuggestions = signal<CustomerDto[]>([]);
  protected readonly customerSuggestOpen = signal(false);
  protected readonly customerSuggestField = signal<'name' | 'phone' | 'address' | null>(null);
  protected readonly customerSuggestFormId = signal<string | null>(null);

  protected readonly timeLimitForm = this.fb.group({
    hours: [2, [Validators.required, Validators.min(0.25), Validators.max(168)]]
  });

  protected readonly forms = signal<LendingDraftForm[]>([this.createDraftForm()]);

  protected readonly showDeadline = computed(() => this.timeLimitEnabled());

  ngOnInit(): void {
    this.loadDefinitions();
    this.wireTimeLimitHours();
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
    this.forms.update((list) => [...list, this.createDraftForm()]);
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
    // Backend available-serials for this definition only (excludes מושאל).
    // Rows stay independent — no filtering against other form rows.
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
    this.refreshAvailability();
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
        this.customers.upsertFromPayload({
          phone1: payload.phone,
          fullName: payload.clientName || null,
          address,
          systemType: SystemType.Tools
        });
        this.data
          .upsertCustomer({
            phone1: payload.phone,
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
        this.forms.update((list) => {
          const remaining = list.filter((f) => f.id !== form.id);
          return remaining.length > 0 ? remaining : [this.createDraftForm()];
        });
        this.refreshAvailability();
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
      this.refreshAvailability();
    });
  }

  private refreshAvailability(): void {
    const defs = this.definitions();
    if (defs.length === 0) {
      this.availableByTool.set(new Map());
      return;
    }

    // Query per tool so colliding serial codes (e.g. "1" on two types) stay independent.
    const requests = defs.map((def) =>
      this.data.getAvailableToolSerials([def.id]).pipe(
        map((codes) => ({ id: def.id, codes }))
      )
    );

    forkJoin(requests).subscribe((results) => {
      const map = new Map<number, string[]>();
      for (const row of results) {
        map.set(row.id, row.codes);
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
      address: '',
      deposit: '',
      notes: '',
      clientAlertNotes: null,
      deadlineAt: timeLimitOn ? this.computeDeadline(createdAt, hours) : null
    };
  }

  private formatHebrewDateTime(date: Date): string {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${this.hebrew.toHebrew(date)} ${hh}:${mm}`;
  }
}
