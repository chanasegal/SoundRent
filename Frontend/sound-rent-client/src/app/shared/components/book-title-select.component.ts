import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  signal
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import { BookTitleOption } from '../../core/models/library-workspace.model';
import {
  BOOK_TITLE_SUGGEST_LIMIT,
  buildBookSearchIndex,
  filterBookTitles
} from '../../core/utils/book-title-search';
import { ClickOutsideDirective } from '../directives/click-outside.directive';

/**
 * Fast book picker for large catalogs.
 * Same architecture as tools lending (local in-memory filter) — but capped DOM
 * results and no PrimeNG Select overhead, so typing stays instant.
 *
 * The suggestion panel uses `position: fixed` (overlay-style) so it floats above
 * sibling form sections and is not clipped by parent overflow/stacking contexts.
 */
@Component({
  selector: 'app-book-title-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ClickOutsideDirective],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => BookTitleSelectComponent),
      multi: true
    }
  ],
  host: {
    '[class.book-title-select--open]': 'open()'
  },
  template: `
    <div
      class="book-title-typeahead"
      (appClickOutside)="closePanel()"
      [appClickOutsideEnabled]="open()"
    >
      <input
        type="text"
        class="book-title-typeahead__input"
        role="combobox"
        aria-autocomplete="list"
        [attr.aria-expanded]="open()"
        [attr.id]="inputId()"
        [placeholder]="placeholder()"
        [disabled]="isDisabled()"
        [value]="inputValue()"
        (focus)="onFocus()"
        (input)="onInput($any($event.target).value)"
        (keydown)="onKeydown($event)"
        autocomplete="off"
      />
      @if (showClear() && value() != null && !isDisabled()) {
        <button
          type="button"
          class="book-title-typeahead__clear"
          aria-label="נקה"
          (mousedown)="$event.preventDefault()"
          (click)="clear()"
        >
          ×
        </button>
      }
      @if (open()) {
        <ul
          class="book-title-typeahead__panel suggest-list"
          role="listbox"
          [style.top.px]="panelTop()"
          [style.left.px]="panelLeft()"
          [style.width.px]="panelWidth()"
          [style.--sr-menu-max-height.px]="panelMaxHeight()"
        >
          @for (opt of filtered(); track opt.id; let i = $index) {
            <li role="option" [attr.aria-selected]="opt.id === value()">
              <button
                type="button"
                class="book-title-typeahead__option"
                [class.book-title-typeahead__option--active]="i === activeIndex()"
                (mousedown)="$event.preventDefault()"
                (click)="select(opt)"
              >
                {{ opt.title }}
              </button>
            </li>
          } @empty {
            <li class="suggest-empty">לא נמצאו ספרים</li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
      max-width: 100%;
      position: relative;
      overflow: visible;
    }

    :host.book-title-select--open {
      z-index: 80;
    }

    .book-title-typeahead {
      position: relative;
      width: 100%;
      overflow: visible;
    }

    .book-title-typeahead__input {
      width: 100%;
      max-width: 100%;
      box-sizing: border-box;
      border-radius: 0.5rem;
      border: 1px solid #cbd5e1;
      background: #fff;
      font-size: 0.875rem;
      min-height: 2.45rem;
      padding: 0.45rem 2rem 0.45rem 0.75rem;
      color: #0f172a;
    }

    .book-title-typeahead__input:hover:not(:disabled) {
      border-color: #94a3b8;
    }

    .book-title-typeahead__input:focus {
      outline: none;
      border-color: #002244;
      box-shadow: 0 0 0 1px #00224433;
    }

    .book-title-typeahead__input:disabled {
      background: #f8fafc;
      color: #94a3b8;
      cursor: not-allowed;
    }

    .book-title-typeahead__clear {
      position: absolute;
      inset-inline-end: 0.35rem;
      top: 50%;
      transform: translateY(-50%);
      border: 0;
      background: transparent;
      color: #64748b;
      font-size: 1.1rem;
      line-height: 1;
      width: 1.6rem;
      height: 1.6rem;
      border-radius: 999px;
      cursor: pointer;
      z-index: 1;
    }

    .book-title-typeahead__clear:hover {
      background: #f1f5f9;
      color: #0f172a;
    }

    .book-title-typeahead__panel {
      position: fixed;
      z-index: 1200;
      margin: 0;
      padding: 0.25rem;
      list-style: none;
      box-sizing: border-box;
      background: #fff;
      border: 1px solid #cbd5e1;
      border-radius: 0.5rem;
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.12);
      overflow: auto;
    }

    .book-title-typeahead__option {
      display: block;
      width: 100%;
      text-align: start;
      border: 0;
      background: transparent;
      border-radius: 0.35rem;
      padding: 0.45rem 0.65rem;
      font-size: 0.875rem;
      color: #0f172a;
      cursor: pointer;
    }

    .book-title-typeahead__option:hover,
    .book-title-typeahead__option--active {
      background: #f1f5f9;
    }
  `
})
export class BookTitleSelectComponent implements ControlValueAccessor {
  /** Slim title rows from the local cache — filtered in memory, never via HTTP while typing. */
  readonly options = input<BookTitleOption[]>([]);
  readonly placeholder = input('הקלידו לחיפוש ספר...');
  readonly showClear = input(true);
  readonly inputId = input<string | undefined>(undefined);

  protected readonly value = signal<number | null>(null);
  protected readonly isDisabled = signal(false);
  protected readonly open = signal(false);
  protected readonly filterText = signal('');
  protected readonly activeIndex = signal(0);
  protected readonly editing = signal(false);
  protected readonly panelTop = signal(0);
  protected readonly panelLeft = signal(0);
  protected readonly panelWidth = signal(0);
  protected readonly panelMaxHeight = signal(250);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);

  private readonly index = computed(() => buildBookSearchIndex(this.options()));

  protected readonly filtered = computed(() =>
    filterBookTitles(this.index(), this.filterText(), {
      limit: BOOK_TITLE_SUGGEST_LIMIT,
      keepId: this.value()
    })
  );

  /** Bound input value — live filter while editing/open, otherwise selected title. */
  protected readonly inputValue = computed(() => {
    if (this.editing() || this.open()) {
      return this.filterText();
    }
    const id = this.value();
    if (id == null) {
      return '';
    }
    return this.options().find((o) => o.id === id)?.title ?? this.filterText();
  });

  private onChange: (value: number | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  private readonly onViewportChange = (): void => {
    if (!this.open()) {
      return;
    }
    this.zone.run(() => this.repositionPanel());
  };

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.zone.runOutsideAngular(() => {
      this.document.addEventListener('scroll', this.onViewportChange, true);
      window.addEventListener('resize', this.onViewportChange);
    });
    destroyRef.onDestroy(() => {
      this.document.removeEventListener('scroll', this.onViewportChange, true);
      window.removeEventListener('resize', this.onViewportChange);
    });

    effect(() => {
      if (!this.open()) {
        return;
      }
      // Re-measure when the filtered list changes (panel height can flip above/below).
      this.filtered();
      queueMicrotask(() => this.repositionPanel());
    });
  }

  writeValue(next: number | null): void {
    this.value.set(next ?? null);
    this.editing.set(false);
    if (next == null) {
      this.filterText.set('');
      return;
    }
    const title = this.options().find((o) => o.id === next)?.title ?? '';
    this.filterText.set(title);
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.isDisabled.set(isDisabled);
  }

  protected onFocus(): void {
    if (this.isDisabled()) {
      return;
    }
    this.editing.set(true);
    this.open.set(true);
    this.activeIndex.set(0);
    // Clear so the next keystrokes narrow immediately (same feel as tools suggest).
    if (this.value() != null) {
      this.filterText.set('');
    }
    void Promise.resolve().then(() => this.repositionPanel());
  }

  protected onInput(raw: string): void {
    this.editing.set(true);
    this.filterText.set(raw);
    this.open.set(true);
    this.activeIndex.set(0);
    if (this.value() != null) {
      this.value.set(null);
      this.onChange(null);
    }
    this.onTouched();
    void Promise.resolve().then(() => this.repositionPanel());
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!this.open()) {
      if (event.key === 'ArrowDown' || event.key === 'Enter') {
        this.open.set(true);
        void Promise.resolve().then(() => this.repositionPanel());
      }
      return;
    }

    const items = this.filtered();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.activeIndex.update((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.activeIndex.update((i) => Math.max(i - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const pick = items[this.activeIndex()] ?? items[0];
      if (pick) {
        this.select(pick);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closePanel();
    }
  }

  protected select(opt: BookTitleOption): void {
    this.value.set(opt.id);
    this.filterText.set(opt.title);
    this.editing.set(false);
    this.open.set(false);
    this.onChange(opt.id);
    this.onTouched();
  }

  protected clear(): void {
    this.value.set(null);
    this.filterText.set('');
    this.editing.set(false);
    this.open.set(false);
    this.onChange(null);
    this.onTouched();
  }

  protected closePanel(): void {
    this.open.set(false);
    this.editing.set(false);
    const id = this.value();
    if (id != null) {
      const title = this.options().find((o) => o.id === id)?.title ?? '';
      this.filterText.set(title);
    }
  }

  private repositionPanel(): void {
    if (!this.open()) {
      return;
    }

    const input =
      (this.host.nativeElement.querySelector(
        '.book-title-typeahead__input'
      ) as HTMLElement | null) ?? this.host.nativeElement;
    const rect = input.getBoundingClientRect();
    const margin = 8;
    const gap = 4;
    const preferredMax = 250;
    const spaceBelow = window.innerHeight - rect.bottom - margin;
    const spaceAbove = rect.top - margin;
    const openAbove = spaceBelow < 160 && spaceAbove > spaceBelow;
    const available = Math.max(120, openAbove ? spaceAbove - gap : spaceBelow - gap);
    const maxHeight = Math.min(preferredMax, available);

    this.panelWidth.set(Math.round(rect.width));
    this.panelMaxHeight.set(Math.round(maxHeight));
    this.panelLeft.set(Math.round(rect.left));

    if (!openAbove) {
      this.panelTop.set(Math.round(rect.bottom + gap));
      return;
    }

    const panel = this.host.nativeElement.querySelector(
      '.book-title-typeahead__panel'
    ) as HTMLElement | null;
    const height = Math.min(panel?.offsetHeight || maxHeight, maxHeight);
    this.panelTop.set(Math.round(rect.top - gap - height));

    // Second pass once the panel has painted at the capped max-height.
    if (!panel || panel.offsetHeight === 0) {
      requestAnimationFrame(() => {
        if (!this.open()) {
          return;
        }
        this.repositionPanel();
      });
    }
  }
}
