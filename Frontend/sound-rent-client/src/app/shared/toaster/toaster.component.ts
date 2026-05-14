import { Component, inject } from '@angular/core';

import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-toaster',
  template: `
    <div class="pointer-events-none fixed left-1/2 top-4 z-[1100] flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4">
      @for (toast of toaster.toasts(); track toast.id) {
        <div
          class="pointer-events-auto rounded-xl border px-4 py-3 shadow-lg animate-[slideIn_0.2s_ease-out]"
          [class.bg-emerald-50]="toast.kind === 'success'"
          [class.border-emerald-200]="toast.kind === 'success'"
          [class.text-emerald-900]="toast.kind === 'success'"
          [class.bg-rose-50]="toast.kind === 'error'"
          [class.border-rose-200]="toast.kind === 'error'"
          [class.text-rose-900]="toast.kind === 'error'"
          [class.bg-sky-50]="toast.kind === 'info'"
          [class.border-sky-200]="toast.kind === 'info'"
          [class.text-sky-900]="toast.kind === 'info'"
          [class.bg-amber-50]="toast.kind === 'warning'"
          [class.border-amber-300]="toast.kind === 'warning'"
          [class.text-amber-950]="toast.kind === 'warning'"
        >
          <div class="flex items-start justify-between gap-3">
            <span class="whitespace-pre-wrap text-sm font-medium leading-snug">{{ toast.message }}</span>
            <button
              type="button"
              class="text-slate-400 transition hover:text-slate-700"
              (click)="toaster.dismiss(toast.id)"
              aria-label="סגור"
            >×</button>
          </div>
        </div>
      }
    </div>
  `
})
export class ToasterComponent {
  protected readonly toaster = inject(ToastService);
}
