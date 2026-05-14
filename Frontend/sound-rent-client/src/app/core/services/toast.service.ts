import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();
  private nextId = 1;

  show(message: string, kind: ToastKind = 'info', durationMs = 4000): void {
    const id = this.nextId++;
    this._toasts.update((items) => [...items, { id, kind, message }]);
    setTimeout(() => this.dismiss(id), durationMs);
  }

  success(message: string): void {
    this.show(message, 'success');
  }

  error(message: string): void {
    this.show(message, 'error', 6000);
  }

  /** High-visibility (longer) toast for cautions such as customer directory notes. */
  warning(message: string, durationMs = 14000): void {
    this.show(message, 'warning', durationMs);
  }

  dismiss(id: number): void {
    this._toasts.update((items) => items.filter((t) => t.id !== id));
  }
}
