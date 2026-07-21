import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators
} from '@angular/forms';
import { finalize } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';

import { BookDto, BookCopyLocationDto } from '../../core/models/library-workspace.model';
import { BooksStore } from '../../core/services/books.store';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import { IntegerOnlyDirective } from '../../shared/directives/integer-only.directive';
import { BookTitleSelectComponent } from '../../shared/components/book-title-select.component';

@Component({
  selector: 'app-library-inventory',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, IntegerOnlyDirective, BookTitleSelectComponent],
  templateUrl: './library-inventory.component.html',
  styleUrl: './library-inventory.component.scss'
})
export class LibraryInventoryComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly booksStore = inject(BooksStore);
  private readonly toast = inject(ToastService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly pageTitle = inject(WorkspaceUiService).title('ניהול ספרים');

  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly inventorySaving = signal(false);
  protected readonly importing = signal(false);
  protected readonly serialSearchLoading = signal(false);
  protected readonly serialSearchAttempted = signal(false);
  protected readonly serialLocationResult = signal<BookCopyLocationDto | null>(null);
  /** Shared sorted catalog (A–Z) — same source as lending / returns. */
  protected readonly definitions = this.booksStore.definitions;

  protected readonly addInventoryOpen = signal(false);
  protected readonly editInventoryOpen = signal(false);
  protected readonly editInventorySaving = signal(false);
  protected readonly editingInventoryId = signal<number | null>(null);
  protected readonly deletingInventoryId = signal<number | null>(null);

  protected readonly inventoryForm = this.fb.group({
    rows: this.fb.array<FormGroup>([])
  });

  protected readonly serialSearchForm = this.fb.group({
    bookId: this.fb.nonNullable.control<number | null>(null),
    copyNumber: ['', Validators.required]
  });

  protected readonly addInventoryForm = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(200)]],
    quantity: [0 as number | null, [Validators.min(0), Validators.max(200)]],
    codes: this.fb.array<FormControl<string>>([])
  });

  protected readonly editInventoryForm = this.fb.group({
    title: ['', [Validators.required, Validators.maxLength(200)]]
  });

  ngOnInit(): void {
    this.wireAddInventoryQuantitySync();
    this.wireSerialSearchTypeFilter();
    this.refresh();
  }

  protected inventoryRows(): FormArray {
    return this.inventoryForm.get('rows') as FormArray;
  }

  protected inventoryRowGroup(index: number): FormGroup {
    return this.inventoryRows().at(index) as FormGroup;
  }

  protected inventoryCodesArray(rowIndex: number): FormArray<FormControl<string>> {
    return this.inventoryRowGroup(rowIndex).get('codes') as FormArray<FormControl<string>>;
  }

  protected codeIndicesForRow(rowIndex: number): number[] {
    const len = this.inventoryCodesArray(rowIndex).length;
    return Array.from({ length: len }, (_, i) => i);
  }

  protected copiesForSearchType(): string[] {
    const id = this.serialSearchForm.controls.bookId.value;
    if (id == null) {
      return this.definitions().flatMap((d) => d.copies);
    }
    return this.definitions().find((d) => d.id === id)?.copies ?? [];
  }

  protected refresh(): void {
    this.loading.set(true);
    this.booksStore.invalidate();
    this.booksStore
      .load({ force: true })
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe(() => {
        const list = this.booksStore.definitions();
        this.rebuildRows(list);
        if (list.length > 0 && this.serialSearchForm.controls.bookId.value == null) {
          this.serialSearchForm.patchValue({ bookId: list[0]!.id });
        }
      });
  }

  protected searchSerialLocation(): void {
    const bookId = this.serialSearchForm.controls.bookId.value;
    const copyNumber = (this.serialSearchForm.controls.copyNumber.value ?? '').trim();
    if (bookId == null) {
      this.toast.error('יש לבחור ספר לחיפוש');
      return;
    }
    if (!copyNumber) {
      this.serialSearchForm.controls.copyNumber.markAsTouched();
      this.toast.error('יש לבחור ברקוד לחיפוש');
      return;
    }

    this.serialSearchLoading.set(true);
    this.serialSearchAttempted.set(true);
    this.data
      .locateBookCopy(copyNumber, bookId)
      .pipe(finalize(() => this.serialSearchLoading.set(false)))
      .subscribe((result) => {
        if (result) {
          this.serialLocationResult.set(result);
        }
      });
  }

  protected clearSerialSearch(): void {
    this.serialSearchAttempted.set(false);
    this.serialLocationResult.set(null);
    this.serialSearchForm.patchValue({ copyNumber: '' });
  }

  protected formatLocatorPhone(phone: string | null | undefined): string {
    const digits = (phone ?? '').replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone ?? '';
  }

  /** Hebrew calendar date for a loaned-item locator card. */
  protected formatLocatorHebrewDate(
    hebrewLentDisplay: string | null | undefined,
    loanDate: string | null | undefined
  ): string {
    const stored = (hebrewLentDisplay ?? '').trim();
    if (stored) {
      const withoutTime = stored.replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*$/, '').trim();
      if (withoutTime) {
        return withoutTime;
      }
    }
    const iso = (loanDate ?? '').trim();
    if (!iso) {
      return '—';
    }
    const date = this.hebrew.parseIso(iso);
    return date ? this.hebrew.toHebrew(date) : '—';
  }

  protected openAddInventoryItem(): void {
    this.addInventoryForm.reset({ title: '', quantity: 0 });
    this.addInventoryCodes().clear();
    this.addInventoryOpen.set(true);
  }

  protected closeAddInventoryItem(): void {
    this.addInventoryOpen.set(false);
  }

  protected showAddInventoryCodes(): boolean {
    return this.toNonNegativeInteger(this.addInventoryForm.controls.quantity.value) > 0;
  }

  protected addInventoryCodes(): FormArray<FormControl<string>> {
    return this.addInventoryForm.get('codes') as FormArray<FormControl<string>>;
  }

  protected addInventoryCodeIndices(): number[] {
    return Array.from({ length: this.addInventoryCodes().length }, (_, i) => i);
  }

  protected autoFillInventoryCodes(): void {
    const codes = this.addInventoryCodes();
    for (let i = 0; i < codes.length; i++) {
      if (!String(codes.at(i).value ?? '').trim()) {
        codes.at(i).setValue(String(i + 1));
      }
    }
  }

  protected focusNextSerialInput(event: Event): void {
    const current = event.target as HTMLInputElement | null;
    if (!current) {
      return;
    }
    event.preventDefault();
    const nodes = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[data-serial-nav="1"]')
    );
    const idx = nodes.indexOf(current);
    if (idx >= 0 && idx < nodes.length - 1) {
      nodes[idx + 1]?.focus();
    }
  }

  protected focusNextAddInventoryCode(event: Event): void {
    const current = event.target as HTMLInputElement | null;
    if (!current) {
      return;
    }
    event.preventDefault();
    const nodes = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[data-serial-nav="inv"]')
    );
    const idx = nodes.indexOf(current);
    if (idx >= 0 && idx < nodes.length - 1) {
      nodes[idx + 1]?.focus();
    }
  }

  protected submitAddInventoryItem(): void {
    if (this.addInventoryForm.invalid) {
      this.addInventoryForm.markAllAsTouched();
      return;
    }

    const title = (this.addInventoryForm.controls.title.value ?? '').trim();
    const quantity = this.toNonNegativeInteger(this.addInventoryForm.controls.quantity.value);
    const copies = this.addInventoryCodes()
      .controls.map((c) => String(c.value ?? '').trim())
      .filter((c) => c.length > 0);

    this.inventorySaving.set(true);
    this.data
      .createBook({ title, quantity, copies })
      .pipe(finalize(() => this.inventorySaving.set(false)))
      .subscribe((created) => {
        if (!created) {
          return;
        }
        this.toast.success('הספר נוסף למלאי');
        this.closeAddInventoryItem();
        this.refresh();
      });
  }

  protected onExcelImportSelected(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0];
    if (input) {
      input.value = '';
    }
    if (!file) {
      return;
    }

    const name = file.name.toLowerCase();
    if (!name.endsWith('.xlsx') && !name.endsWith('.xlsm') && !name.endsWith('.csv')) {
      this.toast.error('יש לבחור קובץ Excel (.xlsx) או CSV');
      return;
    }

    this.importing.set(true);
    this.data
      .importBooksFromExcel(file)
      .pipe(finalize(() => this.importing.set(false)))
      .subscribe((result) => {
        if (!result) {
          return;
        }
        const count = result.importedCount ?? 0;
        this.toast.success(
          result.message?.trim() || `ייבוא הושלם בהצלחה! הוכנסו ${count} ספרים`
        );
        if (count > 0) {
          this.refresh();
        }
      });
  }

  protected openEditInventoryItem(def: BookDto): void {
    this.editingInventoryId.set(def.id);
    this.editInventoryForm.reset({ title: def.title });
    this.editInventoryOpen.set(true);
  }

  protected closeEditInventoryItem(): void {
    this.editInventoryOpen.set(false);
    this.editingInventoryId.set(null);
  }

  protected submitEditInventoryItem(): void {
    const id = this.editingInventoryId();
    if (id == null || this.editInventoryForm.invalid) {
      this.editInventoryForm.markAllAsTouched();
      return;
    }

    const title = (this.editInventoryForm.controls.title.value ?? '').trim();
    this.editInventorySaving.set(true);
    this.data
      .updateBook(id, { title })
      .pipe(finalize(() => this.editInventorySaving.set(false)))
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.toast.success('שם הספר עודכן');
        this.closeEditInventoryItem();
        this.refresh();
      });
  }

  protected deleteInventoryItem(def: BookDto): void {
    if (!confirm(`למחוק את "${def.title}" מהמלאי?`)) {
      return;
    }
    this.deletingInventoryId.set(def.id);
    this.data
      .deleteBook(def.id)
      .pipe(finalize(() => this.deletingInventoryId.set(null)))
      .subscribe((ok) => {
        if (!ok) {
          return;
        }
        this.toast.success('הספר נמחק');
        this.refresh();
      });
  }

  protected saveInventory(): void {
    const items: { id: number; copies: string[] }[] = [];

    for (let i = 0; i < this.inventoryRows().length; i++) {
      const group = this.inventoryRowGroup(i);
      const id = Number(group.get('id')?.value);
      const label = String(group.get('title')?.value ?? '');
      const codesFa = this.inventoryCodesArray(i);
      const copies: string[] = [];

      for (let c = 0; c < codesFa.length; c++) {
        const raw = String(codesFa.at(c).value ?? '').trim();
        if (raw.length === 0) {
          this.toast.error(`יש להזין ברקוד עבור ${label} (#${c + 1})`);
          return;
        }
        if (copies.some((existing) => existing.localeCompare(raw, undefined, { sensitivity: 'accent' }) === 0)) {
          this.toast.error(`קוד כפול עבור ${label}: ${raw}`);
          return;
        }
        copies.push(raw);
      }

      items.push({ id, copies });
    }

    this.saving.set(true);
    this.data
      .updateBooksBatch({ items })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe((results) => {
        if (results === null) {
          return;
        }
        this.toast.success('מלאי הספרים נשמר');
        this.refresh();
      });
  }

  private rebuildRows(defs: BookDto[]): void {
    const rows = this.inventoryRows();
    rows.clear();
    for (const def of defs) {
      const group = this.buildRow(def);
      rows.push(group);
      this.wireRowQuantitySync(group);
    }
  }

  private buildRow(def: BookDto): FormGroup {
    const codes = this.fb.array<FormControl<string>>(
      def.copies.map((code) => this.fb.nonNullable.control(code, [Validators.maxLength(100)]))
    );
    return this.fb.group({
      id: this.fb.nonNullable.control(def.id),
      title: this.fb.nonNullable.control(def.title),
      quantity: this.fb.control(def.copies.length, [Validators.min(0)]),
      codes
    });
  }

  private wireRowQuantitySync(group: FormGroup): void {
    const quantityCtrl = group.get('quantity');
    if (!quantityCtrl) {
      return;
    }
    quantityCtrl.valueChanges
      .pipe(
        map((value) => this.toNonNegativeInteger(value)),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((quantity) => this.setCodesLength(group, quantity));
  }

  private setCodesLength(group: FormGroup, target: number): void {
    const length = this.toNonNegativeInteger(target);
    const codes = group.get('codes') as FormArray<FormControl<string>> | null;
    if (!codes) {
      return;
    }
    while (codes.length < length) {
      codes.push(this.fb.nonNullable.control('', [Validators.maxLength(100)]));
    }
    while (codes.length > length) {
      codes.removeAt(codes.length - 1);
    }
  }

  private wireAddInventoryQuantitySync(): void {
    this.addInventoryForm.controls.quantity.valueChanges
      .pipe(
        map((value) => this.toNonNegativeInteger(value)),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((quantity) => {
        const codes = this.addInventoryCodes();
        while (codes.length < quantity) {
          codes.push(this.fb.nonNullable.control('', [Validators.maxLength(100)]));
        }
        while (codes.length > quantity) {
          codes.removeAt(codes.length - 1);
        }
      });
  }

  private wireSerialSearchTypeFilter(): void {
    this.serialSearchForm.controls.bookId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.serialSearchForm.patchValue({ copyNumber: '' }, { emitEvent: false });
        this.serialLocationResult.set(null);
        this.serialSearchAttempted.set(false);
      });
  }

  private toNonNegativeInteger(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      return 0;
    }
    return Math.min(200, Math.floor(n));
  }
}
