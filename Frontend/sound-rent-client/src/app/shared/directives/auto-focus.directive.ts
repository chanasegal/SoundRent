import {
  afterNextRender,
  booleanAttribute,
  Directive,
  ElementRef,
  inject,
  input
} from '@angular/core';

/**
 * Focuses the host element after the view is rendered (scanner-ready barcode fields).
 *
 * @example
 * ```html
 * <input appAutoFocus id="copyCodeInput" />
 * <input [appAutoFocus]="ready()" />
 * ```
 */
@Directive({
  selector: 'input[appAutoFocus], textarea[appAutoFocus], button[appAutoFocus], [appAutoFocus]',
  standalone: true
})
export class AutoFocusDirective {
  /** When false, skip the initial focus. */
  readonly appAutoFocus = input(true, { transform: booleanAttribute });

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    afterNextRender(() => {
      if (!this.appAutoFocus()) {
        return;
      }
      queueMicrotask(() => this.focusHost());
    });
  }

  /** Imperative focus for sequential scan loops after a successful submit. */
  focusHost(): void {
    const node = this.el.nativeElement;
    if (typeof node.focus !== 'function') {
      return;
    }
    node.focus();
    if (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) {
      node.select();
    }
  }
}
