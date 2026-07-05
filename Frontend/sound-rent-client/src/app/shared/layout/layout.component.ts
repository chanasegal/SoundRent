import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';
import { MemoDropdownComponent } from '../memo/memo-dropdown.component';

@Component({
  selector: 'app-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MemoDropdownComponent],
  template: `
    <div class="flex min-h-screen flex-col bg-slate-50">
      <header class="bg-[#002244] text-white shadow-md">
        <div class="layout-header mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4">
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
              <a
                routerLink="/admin/lost-equipment"
                routerLinkActive="bg-white/10 text-white"
                class="rounded-lg px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-white/10 hover:text-white"
              >ציוד שנשכח</a>
              <a
                routerLink="/admin/blocked-dates"
                routerLinkActive="bg-white/10 text-white"
                class="rounded-lg px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-white/10 hover:text-white"
              >חסימת תאריכים</a>
              <a
                routerLink="/reports"
                routerLinkActive="bg-white/10 text-white"
                class="rounded-lg px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-white/10 hover:text-white"
              >דוחות</a>
            </nav>
          </div>
          <app-memo-dropdown />
        </div>
      </header>

      <main class="flex-1">
        <router-outlet></router-outlet>
      </main>

      <footer class="layout-footer">
        <div class="layout-footer__inner">
          @if (auth.username()) {
            <span class="layout-footer__greeting">שלום, {{ auth.username() }}</span>
          }
          <button
            type="button"
            class="layout-footer__logout"
            (click)="auth.logout()"
          >
            יציאה
          </button>
          <p class="layout-footer__copy">© {{ year }} מערכת שבועית</p>
        </div>
      </footer>
    </div>
  `,
  styleUrl: './layout.component.scss'
})
export class LayoutComponent {
  protected readonly auth = inject(AuthService);
  protected readonly year = new Date().getFullYear();
}
