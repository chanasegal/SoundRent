import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  OnDestroy,
  inject,
  input,
  signal
} from '@angular/core';

import { ClickOutsideDirective } from '../directives/click-outside.directive';

/**
 * Icon/badge tooltip that works on both mouse and touch:
 * - Fine pointer + hover: show on mouseenter, hide on mouseleave
 * - Tap/click: toggle a sticky popup (does not rely on native `title`)
 * - Pointerdown outside the host closes the sticky popup
 *
 * The popup uses `position: fixed` so it stays visible inside scroll/overflow containers
 * (weekly board cells, search panel). Trigger click is stopped so parent buttons
 * (e.g. board order cells) do not activate.
 */
@Component({
  selector: 'app-touch-tooltip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ClickOutsideDirective],
  host: {
    class: 'touch-tooltip',
    '[class.touch-tooltip--open]': 'open()',
    '(mouseenter)': 'onMouseEnter()',
    '(mouseleave)': 'onMouseLeave()'
  },
  template: `
    <span
      class="touch-tooltip__shell"
      appClickOutside
      [appClickOutsideEnabled]="open()"
      (appClickOutside)="close()"
    >
      <span
        class="touch-tooltip__hit"
        role="button"
        tabindex="0"
        [attr.aria-label]="text()"
        [attr.aria-expanded]="open()"
        [attr.aria-describedby]="open() ? panelId : null"
        (click)="onTriggerClick($event)"
        (keydown.enter)="onTriggerClick($event)"
        (keydown.space)="onSpaceKey($event)"
      >
        <ng-content />
      </span>
      @if (open()) {
        <span
          class="touch-tooltip__panel"
          role="tooltip"
          [id]="panelId"
          [style.top.px]="panelTop()"
          [style.left.px]="panelLeft()"
          [style.maxWidth.px]="panelMaxWidth()"
        >
          {{ text() }}
        </span>
      }
    </span>
  `,
  styles: `
    :host {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      vertical-align: middle;
      max-width: 100%;
      line-height: 1;
    }

    .touch-tooltip__shell {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      max-width: 100%;
    }

    .touch-tooltip__hit {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.2rem;
      max-width: 100%;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      line-height: inherit;
      cursor: help;
      appearance: none;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }

    .touch-tooltip__hit:focus-visible {
      outline: 2px solid #0369a1;
      outline-offset: 2px;
      border-radius: 0.25rem;
    }

    .touch-tooltip__panel {
      position: fixed;
      z-index: 12000;
      box-sizing: border-box;
      padding: 0.45rem 0.65rem;
      border-radius: 0.5rem;
      border: 1px solid #cbd5e1;
      background: #0f172a;
      color: #f8fafc;
      font-size: 0.78rem;
      font-weight: 600;
      line-height: 1.35;
      text-align: start;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      box-shadow:
        0 10px 25px rgba(15, 23, 42, 0.28),
        0 2px 6px rgba(15, 23, 42, 0.18);
      pointer-events: none;
      animation: touch-tooltip-in 0.14s ease-out;
    }

    @keyframes touch-tooltip-in {
      from {
        opacity: 0;
        transform: translateY(0.15rem);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `
})
export class TouchTooltipComponent implements OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);
  private static nextId = 0;

  /** Warning / note text shown in the popup. */
  readonly text = input.required<string>();

  protected readonly open = signal(false);
  protected readonly panelTop = signal(0);
  protected readonly panelLeft = signal(0);
  protected readonly panelMaxWidth = signal(280);
  protected readonly panelId = `touch-tooltip-panel-${TouchTooltipComponent.nextId++}`;

  /** Sticky = opened by tap/click; survives mouseleave until outside click or second tap. */
  private sticky = false;
  private readonly hoverMq =
    typeof window !== 'undefined' ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;

  private readonly onViewportChange = (): void => {
    if (!this.open()) {
      return;
    }
    this.zone.run(() => {
      if (this.sticky) {
        this.close();
        return;
      }
      this.reposition();
    });
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
  }

  ngOnDestroy(): void {
    this.close();
  }

  protected onMouseEnter(): void {
    if (!this.supportsHover()) {
      return;
    }
    this.openPopup(false);
  }

  protected onMouseLeave(): void {
    if (!this.supportsHover() || this.sticky) {
      return;
    }
    this.open.set(false);
  }

  protected onTriggerClick(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.open() && this.sticky) {
      this.close();
      return;
    }

    this.openPopup(true);
  }

  protected onSpaceKey(event: Event): void {
    event.preventDefault();
    this.onTriggerClick(event);
  }

  protected close(): void {
    this.sticky = false;
    this.open.set(false);
  }

  private openPopup(sticky: boolean): void {
    this.sticky = sticky;
    this.open.set(true);
    // Measure after the panel is in the DOM.
    void Promise.resolve().then(() => this.reposition());
  }

  private supportsHover(): boolean {
    return this.hoverMq?.matches === true;
  }

  private reposition(): void {
    const trigger = this.host.nativeElement;
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const maxWidth = Math.min(320, Math.max(160, window.innerWidth - margin * 2));
    this.panelMaxWidth.set(maxWidth);

    const panel = trigger.querySelector('.touch-tooltip__panel') as HTMLElement | null;
    const panelWidth = panel?.offsetWidth || Math.min(maxWidth, 240);
    const panelHeight = panel?.offsetHeight || 40;

    let top = rect.bottom + 6;
    if (top + panelHeight > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - panelHeight - 6);
    }

    let left = rect.left + rect.width / 2 - panelWidth / 2;
    left = Math.min(Math.max(margin, left), window.innerWidth - panelWidth - margin);

    this.panelTop.set(Math.round(top));
    this.panelLeft.set(Math.round(left));
  }
}
