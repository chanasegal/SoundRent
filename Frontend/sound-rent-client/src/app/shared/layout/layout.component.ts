import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-layout',
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="flex min-h-screen flex-col bg-slate-50">
      <header class="bg-[#002244] text-white shadow-md">
        <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-4">
          <div class="flex items-center gap-6">
            <a routerLink="/dashboard" class="text-xl font-bold tracking-tight">
              מערכת שבועית
            </a>
            <nav class="hidden gap-1 md:flex">
              <a
                routerLink="/dashboard"
                routerLinkActive="bg-white/10 text-white"
                class="rounded-lg px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-white/10 hover:text-white"
              >לוח שבועי</a>
              <a
                routerLink="/admin/equipment-slots"
                routerLinkActive="bg-white/10 text-white"
                class="rounded-lg px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-white/10 hover:text-white"
              >תאי הזמנה</a>
              <a
                routerLink="/admin/customers"
                routerLinkActive="bg-white/10 text-white"
                class="rounded-lg px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-white/10 hover:text-white"
              >לקוחות</a>
            </nav>
          </div>
          <div class="flex items-center gap-3">
            <span class="hidden text-sm text-sky-100 md:inline">שלום, {{ auth.username() }}</span>
            <button
              type="button"
              class="rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/20"
              (click)="auth.logout()"
            >יציאה</button>
          </div>
        </div>
      </header>

      <main class="flex-1">
        <router-outlet></router-outlet>
      </main>

      <footer class="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        © {{ year }} מערכת שבועית
      </footer>
    </div>
  `
})
export class LayoutComponent {
  protected readonly auth = inject(AuthService);
  protected readonly year = new Date().getFullYear();
}
