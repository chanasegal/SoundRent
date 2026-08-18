import { DOCUMENT } from '@angular/common';
import { Injectable, NgZone, inject } from '@angular/core';

export interface ClickOutsideEntry {
  element: HTMLElement;
  notify: () => void;
  isEnabled: () => boolean;
}

/**
 * Single capture-phase document listener for all [appClickOutside] hosts.
 */
@Injectable({ providedIn: 'root' })
export class ClickOutsideRegistry {
  private readonly entries = new Set<ClickOutsideEntry>();
  private readonly zone = inject(NgZone);
  private listening = false;
  private readonly document = inject(DOCUMENT);

  private readonly onPointerDown = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }

    const toNotify: Array<() => void> = [];
    for (const entry of this.entries) {
      if (!entry.isEnabled()) {
        continue;
      }
      if (!entry.element.contains(target)) {
        toNotify.push(entry.notify);
      }
    }

    if (toNotify.length === 0) {
      return;
    }

    this.zone.run(() => {
      for (const notify of toNotify) {
        notify();
      }
    });
  };

  register(entry: ClickOutsideEntry): () => void {
    this.entries.add(entry);
    this.ensureListening();
    return () => {
      this.entries.delete(entry);
      if (this.entries.size === 0) {
        this.stopListening();
      }
    };
  }

  private ensureListening(): void {
    if (this.listening) {
      return;
    }
    this.listening = true;
    this.zone.runOutsideAngular(() => {
      this.document.addEventListener('pointerdown', this.onPointerDown, true);
    });
  }

  private stopListening(): void {
    if (!this.listening) {
      return;
    }
    this.listening = false;
    this.document.removeEventListener('pointerdown', this.onPointerDown, true);
  }
}
