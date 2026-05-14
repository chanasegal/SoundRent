import { Component, inject } from '@angular/core';

import { LoadingService } from '../../core/services/loading.service';

@Component({
  selector: 'app-spinner',
  template: `
    @if (loading.isLoading()) {
      <div class="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm">
        <div class="flex flex-col items-center gap-3 rounded-2xl bg-white px-8 py-6 shadow-2xl">
          <div class="h-12 w-12 animate-spin rounded-full border-4 border-sky-200 border-t-[#002244]"></div>
          <span class="text-sm font-medium text-slate-700">טוען נתונים...</span>
        </div>
      </div>
    }
  `
})
export class SpinnerComponent {
  protected readonly loading = inject(LoadingService);
}
