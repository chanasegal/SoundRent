import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';

import { OrderDraftService } from '../../core/services/order-draft.service';

@Component({
  selector: 'app-order-draft-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (drafts.showBar()) {
      <div
        class="order-draft-bar"
        role="status"
        aria-live="polite"
      >
        <button
          type="button"
          class="order-draft-bar__main"
          (click)="resume()"
        >
          <span class="order-draft-bar__pulse" aria-hidden="true"></span>
          <span class="order-draft-bar__copy">
            <span class="order-draft-bar__title">{{ drafts.barLabel() }}</span>
            @if (drafts.barDetail(); as detail) {
              <span class="order-draft-bar__detail">{{ detail }}</span>
            }
          </span>
        </button>
        <button
          type="button"
          class="order-draft-bar__dismiss"
          (click)="discard($event)"
          aria-label="מחק טיוטה"
          title="מחק טיוטה"
        >
          ×
        </button>
      </div>
    }
  `,
  styles: `
    .order-draft-bar {
      position: fixed;
      z-index: 1050;
      bottom: max(1rem, env(safe-area-inset-bottom, 0px));
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: stretch;
      width: min(calc(100vw - 1.5rem), 28rem);
      overflow: hidden;
      border-radius: 0.9rem;
      border: 1px solid rgb(186 230 253);
      background: linear-gradient(135deg, #002244 0%, #0a3a66 55%, #0c4a7a 100%);
      box-shadow:
        0 10px 28px rgba(0, 34, 68, 0.28),
        0 2px 8px rgba(15, 23, 42, 0.12);
      animation: order-draft-bar-in 0.22s ease-out;
    }

    .order-draft-bar__main {
      display: flex;
      flex: 1;
      align-items: center;
      gap: 0.75rem;
      min-width: 0;
      padding: 0.85rem 0.9rem 0.85rem 1rem;
      border: 0;
      background: transparent;
      color: #f8fafc;
      text-align: right;
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .order-draft-bar__main:hover {
      background: rgba(255, 255, 255, 0.06);
    }

    .order-draft-bar__pulse {
      flex-shrink: 0;
      width: 0.65rem;
      height: 0.65rem;
      border-radius: 999px;
      background: #38bdf8;
      box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.55);
      animation: order-draft-pulse 1.6s ease-out infinite;
    }

    .order-draft-bar__copy {
      display: flex;
      min-width: 0;
      flex-direction: column;
      gap: 0.15rem;
    }

    .order-draft-bar__title {
      font-size: 0.9rem;
      font-weight: 700;
      line-height: 1.25;
      letter-spacing: 0.01em;
    }

    .order-draft-bar__detail {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 0.78rem;
      font-weight: 500;
      color: rgb(186 230 253);
    }

    .order-draft-bar__dismiss {
      flex-shrink: 0;
      width: 2.75rem;
      border: 0;
      border-inline-start: 1px solid rgba(148, 163, 184, 0.35);
      background: transparent;
      color: rgb(203 213 225);
      font-size: 1.35rem;
      line-height: 1;
      cursor: pointer;
      transition:
        color 0.15s ease,
        background 0.15s ease;
    }

    .order-draft-bar__dismiss:hover {
      color: #fff;
      background: rgba(255, 255, 255, 0.08);
    }

    @keyframes order-draft-bar-in {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(0.6rem);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }

    @keyframes order-draft-pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.55);
      }
      70% {
        box-shadow: 0 0 0 0.55rem rgba(56, 189, 248, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(56, 189, 248, 0);
      }
    }

    @media (max-width: 640px) {
      .order-draft-bar {
        bottom: max(0.75rem, env(safe-area-inset-bottom, 0px));
        width: calc(100vw - 1rem);
        border-radius: 0.8rem;
      }

      .order-draft-bar__main {
        padding: 0.75rem 0.7rem 0.75rem 0.85rem;
      }

      .order-draft-bar__title {
        font-size: 0.84rem;
      }
    }
  `
})
export class OrderDraftBarComponent {
  protected readonly drafts = inject(OrderDraftService);
  private readonly router = inject(Router);

  protected resume(): void {
    const snap = this.drafts.beginResume();
    if (!snap) {
      return;
    }
    const path = snap.resumePath?.trim();
    if (!path || !path.startsWith('/') || path.startsWith('//')) {
      return;
    }
    void this.router.navigateByUrl(path);
  }

  protected discard(event: Event): void {
    event.stopPropagation();
    this.drafts.clear();
  }
}
