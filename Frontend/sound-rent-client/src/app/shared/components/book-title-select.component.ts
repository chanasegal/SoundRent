import { ChangeDetectionStrategy, Component, forwardRef, input } from '@angular/core';
import {
  ControlValueAccessor,
  FormsModule,
  NG_VALUE_ACCESSOR
} from '@angular/forms';
import { Select } from 'primeng/select';

import { BookDto } from '../../core/models/library-workspace.model';

/**
 * Lightning-fast tool-type picker: filters a locally cached list in memory.
 * No HTTP during typing — PrimeNG's client-side filter only.
 */
@Component({
  selector: 'app-book-title-select',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Select, FormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => BookTitleSelectComponent),
      multi: true
    }
  ],
  template: `
    <p-select
      class="book-title-select"
      [options]="options()"
      optionLabel="title"
      optionValue="id"
      dataKey="id"
      [ngModel]="value"
      (ngModelChange)="onModelChange($event)"
      [filter]="true"
      filterBy="title"
      filterMatchMode="contains"
      [placeholder]="placeholder()"
      [showClear]="showClear()"
      [disabled]="isDisabled"
      [inputId]="inputId()"
      [virtualScroll]="options().length > 60"
      [virtualScrollItemSize]="38"
      [virtualScrollOptions]="{ scrollHeight: '280px' }"
      [resetFilterOnHide]="true"
      appendTo="body"
      [fluid]="true"
      emptyFilterMessage="לא נמצאו ספרים"
      emptyMessage="אין ספרים"
    />
  `,
  styles: `
    :host {
      display: block;
      width: 100%;
    }

    :host ::ng-deep .book-title-select.p-select,
    :host ::ng-deep .p-select {
      width: 100%;
      border-radius: 0.5rem;
      border: 1px solid #cbd5e1;
      font-size: 0.875rem;
      min-height: 2.45rem;
    }

    :host ::ng-deep .p-select:not(.p-disabled):hover {
      border-color: #94a3b8;
    }

    :host ::ng-deep .p-select.p-focus {
      border-color: #002244;
      box-shadow: 0 0 0 1px #00224433;
    }
  `
})
export class BookTitleSelectComponent implements ControlValueAccessor {
  /** Already-loaded tool types — filtered purely client-side. */
  readonly options = input<BookDto[]>([]);
  readonly placeholder = input('הקלידו לחיפוש ספר...');
  readonly showClear = input(true);
  readonly inputId = input<string | undefined>(undefined);

  protected value: number | null = null;
  protected isDisabled = false;

  private onChange: (value: number | null) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: number | null): void {
    this.value = value ?? null;
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.isDisabled = isDisabled;
  }

  protected onModelChange(next: number | null): void {
    this.value = next ?? null;
    this.onChange(this.value);
    this.onTouched();
  }
}
