import { ChangeDetectionStrategy, Component, computed, HostListener, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

import { SYSTEM_TYPE_LABELS, SYSTEM_TYPE_OPTIONS, SystemType } from '../../core/models/enums';
import { AuthService } from '../../core/services/auth.service';
import { CalendarViewStateService } from '../../core/services/calendar-view-state.service';
import { CustomersStore } from '../../core/services/customers.store';
import { EquipmentDefinitionsStore } from '../../core/services/equipment-definitions.store';
import { SystemContextService } from '../../core/services/system-context.service';
import { MemoDropdownComponent } from '../memo/memo-dropdown.component';

@Component({
  selector: 'app-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MemoDropdownComponent],
  template: `
    <div class="flex min-h-screen flex-col bg-slate-50">
      <header class="bg-[#002244] text-white shadow-md">
        <div class="layout-header flex w-full items-center justify-between gap-3 px-3 py-3 lg:px-4">
          <nav
            class="layout-nav hidden min-w-0 flex-1 items-center md:flex"
            aria-label="תפריט ראשי"
          >
              <div class="relative shrink-0" data-board-menu>
                <button
                  type="button"
                  class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium text-sky-100 transition hover:bg-white/10 hover:text-white"
                  [class.bg-white/10]="boardMenuOpen()"
                  [class.text-white]="boardMenuOpen()"
                  (click)="toggleBoardMenu($event)"
                  [attr.aria-expanded]="boardMenuOpen()"
                  aria-haspopup="menu"
                  [attr.aria-label]="'מערכת פעילה: ' + systemLabels[currentSystemType()]"
                >
                  {{ systemLabels[currentSystemType()] }}
                  <svg
                    class="h-3.5 w-3.5 opacity-80 transition"
                    [class.rotate-180]="boardMenuOpen()"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path
                      fill-rule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 11.17l3.71-3.94a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                      clip-rule="evenodd"
                    />
                  </svg>
                </button>
                @if (boardMenuOpen()) {
                  <div
                    role="menu"
                    class="absolute start-0 z-50 mt-1 min-w-[11rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-slate-800 shadow-lg"
                  >
                    @for (option of systemOptions; track option) {
                      <button
                        type="button"
                        role="menuitem"
                        class="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-right text-sm transition hover:bg-sky-50"
                        [class.bg-sky-50]="option === currentSystemType()"
                        [class.font-semibold]="option === currentSystemType()"
                        [class.text-sky-900]="option === currentSystemType()"
                        (click)="selectSystem(option)"
                      >
                        <span>{{ systemLabels[option] }}</span>
                        @if (option === currentSystemType()) {
                          <span class="text-sky-600" aria-hidden="true">✓</span>
                        }
                      </button>
                    }
                  </div>
                }
              </div>

              <a
                routerLink="/dashboard"
                [queryParams]="boardQueryParams()"
                routerLinkActive="bg-white/10 text-white"
                class="layout-nav__link"
              >לוח שבועי</a>
              <a
                routerLink="/admin/equipment-report"
                routerLinkActive="bg-white/10 text-white"
                class="layout-nav__link"
              >דוח ציוד</a>
              <a
                routerLink="/admin/quick-loan"
                routerLinkActive="bg-white/10 text-white"
                class="layout-nav__link"
              >השאלת אביזרים</a>
              <a
                routerLink="/admin/loans"
                routerLinkActive="bg-white/10 text-white"
                class="layout-nav__link"
              >השאלות</a>
              <a
                routerLink="/admin/returns"
                routerLinkActive="bg-white/10 text-white"
                class="layout-nav__link"
              >החזרות</a>
              <a
                routerLink="/admin/equipment-slots"
                routerLinkActive="bg-white/10 text-white"
                class="layout-nav__link"
              >ניהול ציוד</a>
              <a
                routerLink="/admin/customers"
                routerLinkActive="bg-white/10 text-white"
                class="layout-nav__link"
              >לקוחות</a>
              <a
                routerLink="/admin/lost-equipment"
                routerLinkActive="bg-white/10 text-white"
                class="layout-nav__link"
              >ציוד שנשכח</a>
              <a
                routerLink="/admin/unreturned-items"
                routerLinkActive="bg-white/10 text-white"
                class="layout-nav__link"
              >פריטים שלא חזרו</a>
              <a
                routerLink="/admin/blocked-dates"
                routerLinkActive="bg-white/10 text-white"
                class="layout-nav__link"
              >חסימת תאריכים</a>
              <a
                routerLink="/reports"
                routerLinkActive="bg-white/10 text-white"
                class="layout-nav__link"
              >דוחות</a>
          </nav>
          <div class="shrink-0">
            <app-memo-dropdown />
          </div>
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
  private readonly systemContext = inject(SystemContextService);
  private readonly equipmentSlots = inject(EquipmentDefinitionsStore);
  private readonly customersStore = inject(CustomersStore);
  private readonly router = inject(Router);

  protected readonly boardQueryParams = computed(() => this.calendarView.dashboardQueryParams());
  protected readonly year = new Date().getFullYear();
  protected readonly boardMenuOpen = signal(false);
  protected readonly systemOptions = SYSTEM_TYPE_OPTIONS;
  protected readonly systemLabels = SYSTEM_TYPE_LABELS;
  protected readonly currentSystemType = this.systemContext.currentSystemType;

  constructor() {
    this.ensureSoundContext();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.boardMenuOpen()) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-board-menu]')) {
      return;
    }
    this.boardMenuOpen.set(false);
  }

  protected toggleBoardMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.boardMenuOpen.update((open) => !open);
  }

  protected selectSystem(systemType: SystemType): void {
    this.boardMenuOpen.set(false);
    if (this.currentSystemType() === systemType) {
      return;
    }
    this.systemContext.setSystemType(systemType);
    this.customersStore.invalidate();
    this.equipmentSlots.invalidate();

    if (systemType === SystemType.Sound) {
      this.equipmentSlots.load({ force: true }).subscribe();
      return;
    }

    void this.router.navigateByUrl(this.systemContext.workspaceHomePath(systemType));
  }

  private ensureSoundContext(): void {
    if (this.currentSystemType() === SystemType.Sound) {
      return;
    }
    this.systemContext.setSystemType(SystemType.Sound);
    this.customersStore.invalidate();
    this.equipmentSlots.invalidate();
  }
}
