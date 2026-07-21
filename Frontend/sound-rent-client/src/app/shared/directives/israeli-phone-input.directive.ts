import { Directive, ElementRef, HostListener, inject } from '@angular/core';
import { NgControl } from '@angular/forms';

import {
  clampIsraeliPhoneDigits,
  getIsraeliPhoneMaxLength
} from '../../core/validators/israeli-phone.validator';

/**
 * Real-time Israeli phone input mask:
 * - Digits only
 * - Landline prefixes (`02`/`03`/`04`/`07`/`08`/`09`) → max 9 digits
 * - Mobile prefix (`05`) → max 10 digits
 * - Truncates on paste / fast input; blocks further digit keypresses at the limit
 *
 * @example
 * ```html
 * <input type="tel" inputmode="numeric" appIsraeliPhoneInput formControlName="phone" />
 * ```
 */
@Directive({
  selector: 'input[appIsraeliPhoneInput]',
  standalone: true
})
export class IsraeliPhoneInputDirective {
  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private readonly ngControl = inject(NgControl, { optional: true });

  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.isDigitKey(event) || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const target = this.el.nativeElement;
    const digits = target.value.replace(/\D/g, '');
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? target.value.length;
    if (start !== end) {
      return;
    }

    const max = getIsraeliPhoneMaxLength(digits);
    if (digits.length >= max) {
      event.preventDefault();
    }
  }

  @HostListener('paste', ['$event'])
  onPaste(event: ClipboardEvent): void {
    event.preventDefault();
    const pasted = event.clipboardData?.getData('text') ?? '';
    const target = this.el.nativeElement;
    const current = target.value;
    const start = target.selectionStart ?? current.length;
    const end = target.selectionEnd ?? current.length;
    const merged = current.slice(0, start) + pasted + current.slice(end);
    const next = clampIsraeliPhoneDigits(merged);
    this.writeValue(next, next.length);
  }

  @HostListener('input')
  onInput(): void {
    this.applyClamp();
  }

  @HostListener('focus')
  onFocus(): void {
    this.applyClamp();
  }

  private applyClamp(): void {
    const target = this.el.nativeElement;
    const next = clampIsraeliPhoneDigits(target.value);
    const max = getIsraeliPhoneMaxLength(next);
    target.maxLength = max;

    if (next !== target.value) {
      const caret = target.selectionStart ?? next.length;
      this.writeValue(next, Math.min(caret, next.length));
      return;
    }

    if (this.ngControl?.control && String(this.ngControl.control.value ?? '') !== next) {
      this.ngControl.control.setValue(next, { emitEvent: true });
    }
  }

  private writeValue(value: string, caret?: number): void {
    const target = this.el.nativeElement;
    target.maxLength = getIsraeliPhoneMaxLength(value);
    target.value = value;

    if (caret !== undefined && typeof target.setSelectionRange === 'function') {
      try {
        target.setSelectionRange(caret, caret);
      } catch {
        // Some input types don't support selection ranges.
      }
    }

    if (this.ngControl?.control) {
      this.ngControl.control.setValue(value, { emitEvent: true });
    }
  }

  private isDigitKey(event: KeyboardEvent): boolean {
    return event.key.length === 1 && /\d/.test(event.key);
  }
}
