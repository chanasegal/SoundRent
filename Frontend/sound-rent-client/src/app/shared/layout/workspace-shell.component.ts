import {
  ChangeDetectionStrategy,
  Component,
  computed,
  HostListener,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs/operators';

import { SYSTEM_TYPE_LABELS, SYSTEM_TYPE_OPTIONS, SystemType } from '../../core/models/enums';
import { AuthService } from '../../core/services/auth.service';
import { CustomersStore } from '../../core/services/customers.store';
import { EquipmentDefinitionsStore } from '../../core/services/equipment-definitions.store';
import { SystemContextService } from '../../core/services/system-context.service';

/**
 * Isolated Tools / Library application shell — Customers only in the nav.
 * Workspace switcher sits at the start of the header (no brand title text).
 */
@Component({
  selector: 'app-workspace-shell',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="flex min-h-screen flex-col bg-slate-50">
      <header class="bg-[#002244] text-white shadow-md">
        <div class="layout-header flex w-full items-center justify-between gap-3 px-3 py-3 lg:px-4">
          <div class="flex min-w-0 flex-1 items-center gap-3">
            <div class="relative shrink-0" data-workspace-switcher>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium text-sky-100 transition hover:bg-white/10 hover:text-white"
                [class.bg-white/10]="switcherOpen()"
                [class.text-white]="switcherOpen()"
                (click)="toggleSwitcher($event)"
                [attr.aria-expanded]="switcherOpen()"
                aria-haspopup="menu"
                [attr.aria-label]="'מערכת פעילה: ' + systemLabels[currentSystemType()]"
              >
                {{ systemLabels[currentSystemType()] }}
                <svg
                  class="h-3.5 w-3.5 opacity-80 transition"
                  [class.rotate-180]="switcherOpen()"
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
              @if (switcherOpen()) {
                <div
                  role="menu"
                  class="absolute start-0 z-50 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 text-slate-800 shadow-lg"
                >
                  @for (option of systemOptions; track option) {
                    <button
                      type="button"
                      role="menuitem"
                      class="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-right text-sm transition hover:bg-sky-50"
                      [class.bg-sky-50]="option === currentSystemType()"
                      [class.font-semibold]="option === currentSystemType()"
                      [class.text-sky-900]="option === currentSystemType()"
                      (click)="selectWorkspace(option)"
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

            <nav class="hidden gap-3 md:flex" aria-label="תפריט מערכת">
              <a
                [routerLink]="customersPath()"
                routerLinkActive="bg-white/10 text-white"
                class="rounded-lg px-3.5 py-2 text-sm font-medium text-sky-100 transition hover:bg-white/10 hover:text-white"
              >לקוחות</a>
            </nav>
          </div>
        </div>
      </header>

      <main class="flex-1">
        <router-outlet></router-outlet>
      </main>

      <footer class="layout-footer">
        <div class="layout-footer__inner flex flex-wrap items-center justify-between gap-4">
          <button type="button" class="layout-footer__logout" (click)="auth.logout()">
            יציאה
          </button>
          <div class="layout-footer__info flex items-center gap-2 text-sm text-slate-500">
            <p class="layout-footer__copy !m-0 !p-0 !text-sm !leading-none !text-slate-500">
              © {{ year }} מערכת שבועית · {{ systemLabels[currentSystemType()] }}
            </p>
            <span class="text-slate-300">|</span>
            <a
              href="mailto:chanasegal99@gmail.com"
              class="!m-0 !cursor-pointer !p-0 !text-sm !leading-none !text-slate-500 no-underline"
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
export class WorkspaceShellComponent {
  protected readonly auth = inject(AuthService);
  private readonly systemContext = inject(SystemContextService);
  private readonly customersStore = inject(CustomersStore);
  private readonly equipmentSlots = inject(EquipmentDefinitionsStore);
  private readonly router = inject(Router);

  protected readonly year = new Date().getFullYear();
  protected readonly switcherOpen = signal(false);
  protected readonly systemOptions = SYSTEM_TYPE_OPTIONS;
  protected readonly systemLabels = SYSTEM_TYPE_LABELS;
  protected readonly currentSystemType = this.systemContext.currentSystemType;
  protected readonly customersPath = computed(() => this.systemContext.workspaceCustomersPath());

  constructor() {
    this.syncFromUrl(this.router.url);
    this.router.events
      .pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed()
      )
      .subscribe((e) => this.syncFromUrl(e.urlAfterRedirects));
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.switcherOpen()) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-workspace-switcher]')) {
      return;
    }
    this.switcherOpen.set(false);
  }

  protected toggleSwitcher(event: MouseEvent): void {
    event.stopPropagation();
    this.switcherOpen.update((open) => !open);
  }

  protected selectWorkspace(systemType: SystemType): void {
    this.switcherOpen.set(false);
    const changed = this.currentSystemType() !== systemType;
    this.systemContext.setSystemType(systemType);
    if (changed) {
      this.customersStore.invalidate();
      this.equipmentSlots.invalidate();
    }
    void this.router.navigateByUrl(this.systemContext.workspaceHomePath(systemType));
  }

  private syncFromUrl(url: string): void {
    const path = url.split('?')[0] ?? '';
    if (!path.startsWith('/tools') && !path.startsWith('/library')) {
      return;
    }
    const slug = path.startsWith('/library') ? 'library' : 'tools';
    const systemType = this.systemContext.systemTypeFromSlug(slug);
    const changed = this.currentSystemType() !== systemType;
    this.systemContext.setSystemType(systemType);
    if (changed) {
      this.customersStore.invalidate();
      this.equipmentSlots.invalidate();
    }
  }
}
