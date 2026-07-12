import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';
import { CalendarViewStateService } from '../../core/services/calendar-view-state.service';
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
            <a routerLink="/dashboard" [queryParams]="boardQueryParams()" class="text-xl font-bold tracking-tight">
              מערכת שבועית
            </a>
            <nav class="hidden gap-1 md:flex">
              <a
                routerLink="/dashboard"
                [queryParams]="boardQueryParams()"
                routerLinkActive="bg-white/10 text-white"
                class="rounded-lg px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-white/10 hover:text-white"
              >לוח שבועי</a>
              <a
                routerLink="/admin/equipment-report"
                routerLinkActive="bg-white/10 text-white"
                class="rounded-lg px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-white/10 hover:text-white"
              >דוח ציוד</a>
              <a
                routerLink="/admin/quick-loan"
                routerLinkActive="bg-white/10 text-white"
                class="rounded-lg px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-white/10 hover:text-white"
              >השאלת אביזרים</a>
              <a
                routerLink="/admin/equipment-slots"
                routerLinkActive="bg-white/10 text-white"
                class="rounded-lg px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-white/10 hover:text-white"
              >ניהול ציוד</a>
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
                routerLink="/admin/unreturned-items"
                routerLinkActive="bg-white/10 text-white"
                class="rounded-lg px-4 py-2 text-sm font-medium text-sky-100 transition hover:bg-white/10 hover:text-white"
              >פריטים שלא חזרו</a>
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
  <div class="layout-footer__inner flex flex-wrap items-center justify-between gap-4">
    <button
      type="button"
      class="layout-footer__logout"
      (click)="auth.logout()"
    >
      יציאה
    </button>
    
    <div class="layout-footer__info flex items-center gap-2 text-sm text-slate-500">
      <p class="layout-footer__copy !text-sm !text-slate-500 !m-0 !p-0 !leading-none">© {{ year }} מערכת שבועית</p>
      
      <span class="text-slate-300">|</span>
      
      <a 
        href="mailto:chanasegal99@gmail.com" 
        class="!text-sm !text-slate-500 no-underline cursor-pointer !m-0 !p-0 !leading-none"
      >
        נבנה על ידי chana segal
      </a>
    </div>
  </div>
</footer>
    </div>
  `,
  styleUrl: './layout.component.scss'
})
export class LayoutComponent {
  protected readonly auth = inject(AuthService);
  private readonly calendarView = inject(CalendarViewStateService);
  protected readonly boardQueryParams = computed(() => this.calendarView.dashboardQueryParams());
  protected readonly year = new Date().getFullYear();
}