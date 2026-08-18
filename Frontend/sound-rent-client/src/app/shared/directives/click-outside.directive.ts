import { Directive, ElementRef, OnDestroy, booleanAttribute, inject, input, output } from '@angular/core';

import { ClickOutsideRegistry } from './click-outside.registry';

/**
 * Emits when a pointerdown happens outside the host.
 * Put it on the wrapper that includes both the trigger and the open panel
 * so inside-menu clicks (and the toggle itself) do not close the menu.
 *
 * @example
 * ```html
 * <div
 *   (appClickOutside)="close()"
 *   [appClickOutsideEnabled]="open()"
 * >
 *   <button type="button" (click)="toggle()">…</button>
 *   @if (open()) { <ul>…</ul> }
 * </div>
 * ```
 */
@Directive({
  selector: '[appClickOutside]',
  standalone: true
})
export class ClickOutsideDirective implements OnDestroy {
  /** When false, outside clicks are ignored (keep this tied to the open state). */
  readonly appClickOutsideEnabled = input(true, { transform: booleanAttribute });
  readonly appClickOutside = output<void>();

  private readonly unregister: () => void;

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const registry = inject(ClickOutsideRegistry);

    this.unregister = registry.register({
      element: el,
      notify: () => this.appClickOutside.emit(),
      isEnabled: () => this.appClickOutsideEnabled()
    });
  }

  ngOnDestroy(): void {
    this.unregister();
  }
}
