import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  input,
  output,
  signal,
  viewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { sortNumericCodes } from '../../core/utils/numeric-code-sort';
import { BookTitleSelectComponent } from '../../shared/components/book-title-select.component';
import { AutoFocusDirective } from '../../shared/directives/auto-focus.directive';

export interface ReturnsQuickSearchRequest {
  bookId: number | null;
  code: string;
  charge: string;
}

export interface ReturnsHistorySearchRequest {
  bookId: number | null;
  code: string;
}

/**
 * Isolated OnPush search chrome for Library Returns.
 * Book-title typing and barcode keystrokes stay inside this component so the
 * heavy returns cards list in the parent never re-renders while searching.
 *
 * Copy codes / counts resolve from the parent’s preloaded availability map —
 * never via per-book `ensureCopies` network calls on select.
 */
@Component({
  selector: 'app-library-returns-filters',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, BookTitleSelectComponent, AutoFocusDirective],
  templateUrl: './library-returns-filters.component.html',
  styleUrl: './library-returns-filters.component.scss'
})
export class LibraryReturnsFiltersComponent {
  /** Bulk available copies from parent (New Loan strategy). */
  readonly availableByBook = input<ReadonlyMap<number, string[]>>(new Map());

  readonly quickReturnSearching = input(false);
  readonly quickReturnSaving = input(false);
  readonly historySearching = input(false);
  readonly historyMode = input(false);
  readonly historyCodeLabel = input('');

  readonly quickReturnSearch = output<ReturnsQuickSearchRequest>();
  readonly historySearch = output<ReturnsHistorySearchRequest>();
  readonly clearHistory = output<void>();

  private readonly barcodeField = viewChild<ElementRef<HTMLInputElement>>('barcodeField');
  private readonly quickReturnBarcodeField =
    viewChild<ElementRef<HTMLInputElement>>('quickReturnBarcodeField');
  private readonly quickReturnChargeField =
    viewChild<ElementRef<HTMLInputElement>>('quickReturnChargeField');

  protected readonly quickReturnToolId = signal<number | null>(null);
  protected readonly historyToolId = signal<number | null>(null);

  /** Instant in-memory codes for the selected quick-return book. */
  protected readonly quickReturnCodes = computed(() => this.codesForBook(this.quickReturnToolId()));

  /** Instant in-memory codes for the selected history book. */
  protected readonly historyCodes = computed(() => this.codesForBook(this.historyToolId()));

  /** Same meta counts as New Loan suggest rows — derived from the bulk map. */
  protected readonly availableCounts = computed(() => {
    const counts = new Map<number, number>();
    for (const [bookId, copies] of this.availableByBook()) {
      counts.set(bookId, copies.length);
    }
    return counts;
  });

  protected onQuickReturnToolChange(bookId: number | null): void {
    const next = bookId != null && bookId > 0 ? bookId : null;
    if (next === this.quickReturnToolId()) {
      return;
    }
    this.quickReturnToolId.set(next);
    this.setQuickReturnBarcode('');
    // Codes resolve from availableByBook via computed — zero network on select.
  }

  protected onHistoryToolChange(bookId: number | null): void {
    const next = bookId != null && bookId > 0 ? bookId : null;
    if (next === this.historyToolId()) {
      return;
    }
    this.historyToolId.set(next);
    this.setHistoryBarcode('');
  }

  protected onQuickReturnKeydownEnter(event: Event): void {
    event.preventDefault();
    this.emitQuickReturnSearch();
  }

  protected onHistoryKeydownEnter(event: Event): void {
    event.preventDefault();
    this.emitHistorySearch();
  }

  protected emitQuickReturnSearch(): void {
    this.quickReturnSearch.emit({
      bookId: this.quickReturnToolId(),
      code: this.readQuickReturnBarcode(),
      charge: this.readQuickReturnCharge()
    });
  }

  protected emitHistorySearch(): void {
    this.historySearch.emit({
      bookId: this.historyToolId(),
      code: this.readHistoryBarcode()
    });
  }

  protected emitClearHistory(): void {
    this.historyToolId.set(null);
    this.setHistoryBarcode('');
    this.clearHistory.emit();
  }

  /** Used by parent wedge scanner / post-return focus. */
  applyWedgeCode(code: string): void {
    this.setQuickReturnBarcode(code);
    this.emitQuickReturnSearch();
  }

  focusQuickReturnBarcode(): void {
    queueMicrotask(() => {
      const el = this.quickReturnBarcodeField()?.nativeElement;
      if (!el) {
        return;
      }
      el.focus();
      el.select();
    });
  }

  focusHistoryBarcode(): void {
    queueMicrotask(() => {
      const el = this.barcodeField()?.nativeElement;
      if (!el) {
        return;
      }
      el.focus();
      el.select();
    });
  }

  clearQuickReturnFields(): void {
    this.setQuickReturnBarcode('');
    this.setQuickReturnCharge('');
  }

  setSelectedQuickReturnBook(bookId: number): void {
    this.onQuickReturnToolChange(bookId);
  }

  setSelectedHistoryBook(bookId: number): void {
    this.historyToolId.set(bookId > 0 ? bookId : null);
  }

  private codesForBook(bookId: number | null): string[] {
    if (bookId == null) {
      return [];
    }
    return sortNumericCodes([...(this.availableByBook().get(bookId) ?? [])]);
  }

  private readQuickReturnBarcode(): string {
    return (this.quickReturnBarcodeField()?.nativeElement.value ?? '').trim();
  }

  private setQuickReturnBarcode(value: string): void {
    const el = this.quickReturnBarcodeField()?.nativeElement;
    if (el) {
      el.value = value;
    }
  }

  private readQuickReturnCharge(): string {
    return (this.quickReturnChargeField()?.nativeElement.value ?? '').trim();
  }

  private setQuickReturnCharge(value: string): void {
    const el = this.quickReturnChargeField()?.nativeElement;
    if (el) {
      el.value = value;
    }
  }

  private readHistoryBarcode(): string {
    return (this.barcodeField()?.nativeElement.value ?? '').trim();
  }

  private setHistoryBarcode(value: string): void {
    const el = this.barcodeField()?.nativeElement;
    if (el) {
      el.value = value;
    }
  }
}
