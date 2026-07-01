import { booleanAttribute, Directive, ElementRef, HostListener, inject, Input } from '@angular/core';
import { NgControl } from '@angular/forms';

/**
 * Restricts an `<input>` to whole, non-negative integers.
 *
 * - Blocks `.` / `,` / `e` / `E` / `+` / `-` at the keydown stage so the
 *   browser never accepts a decimal point or scientific notation.
 * - Sanitizes pasted content by stripping every non-digit character.
 * - Re-sanitizes on `input` as a safety net for IME / mobile keyboards / programmatic input.
 * - Keeps any bound `FormControl` in sync, converting to a `number` when the
 *   underlying element is `type="number"` and to a plain string otherwise.
 * - With `zeroDefault`, focusing a field whose value is `0` clears it for
 *   immediate entry; focusing any other value selects it. Blur on empty restores `0`.
 *
 * Pair this directive with `inputmode="numeric"` and `pattern="[0-9]*"` on the
 * element itself so mobile devices surface the numeric keypad.
 *
 * @example
 * ```html
 * <input
 *   type="number"
 *   inputmode="numeric"
 *   pattern="[0-9]*"
 *   appIntegerOnly
 *   zeroDefault
 *   formControlName="quantity"
 * />
 * ```
 */
@Directive({
  selector: 'input[appIntegerOnly]',
  standalone: true
})
export class IntegerOnlyDirective {
  /** When true, focus on `0` selects the value; blur on empty restores `0`. */
  @Input({ transform: booleanAttribute }) zeroDefault = false;

  /** Keys that would produce a non-integer value (decimal, exponent, sign). */
  private static readonly BLOCKED_KEYS = new Set(['.', ',', 'e', 'E', '+', '-']);

  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private readonly ngControl = inject(NgControl, { optional: true });

  @HostListener('focus')
  onFocus(): void {
    if (!this.zeroDefault) {
      return;
    }

    queueMicrotask(() => {
      const target = this.el.nativeElement;
      const controlValue = this.ngControl?.control?.value;
      const display = target.value;
      const num = Number(controlValue ?? display);

      if (display === '' || controlValue === null || controlValue === undefined) {
        return;
      }

      if (num === 0) {
        this.writeValue('', undefined, false);
        return;
      }

      try {
        target.select();
      } catch {
        // Ignore — partial selection is still usable.
      }
    });
  }

  @HostListener('blur')
  onBlur(): void {
    if (!this.zeroDefault) {
      return;
    }

    if (this.el.nativeElement.value.trim() === '') {
      this.writeValue('0');
    }
  }

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (IntegerOnlyDirective.BLOCKED_KEYS.has(event.key)) {
      event.preventDefault();
    }
  }

  @HostListener('paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const pasted = event.clipboardData?.getData('text') ?? '';
    const sanitized = pasted.replace(/\D+/g, '');
    if (!sanitized) {
      return;
    }

    const target = this.el.nativeElement;
    const current = target.value;
    const start = target.selectionStart ?? current.length;
    const end = target.selectionEnd ?? current.length;
    const next = current.slice(0, start) + sanitized + current.slice(end);
    this.writeValue(next, start + sanitized.length);
  }

  @HostListener('input')
  onInput(): void {
    const raw = this.el.nativeElement.value;
    const sanitized = raw.replace(/\D+/g, '');
    if (sanitized !== raw) {
      this.writeValue(sanitized);
    }
  }

  /**
   * Writes the sanitized value back to both the DOM and the bound `FormControl`,
   * mirroring the native type so the rest of the form sees the value it expects.
   */
  private writeValue(value: string, caret?: number, emitEvent = true): void {
    const target = this.el.nativeElement;
    target.value = value;

    if (caret !== undefined && typeof target.setSelectionRange === 'function') {
      try {
        target.setSelectionRange(caret, caret);
      } catch {
        // Some input types (e.g. `number`) don't support selection ranges; ignore.
      }
    }

    if (this.ngControl?.control) {
      const isNumber = target.type === 'number';
      const next: number | string | null =
        value === '' ? null : isNumber ? Number(value) : value;
      this.ngControl.control.setValue(next, { emitEvent });
    }
  }
}
