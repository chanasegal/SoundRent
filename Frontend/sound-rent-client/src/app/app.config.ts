import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  APP_INITIALIZER,
  ApplicationConfig,
  LOCALE_ID,
  isDevMode,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import Aura from '@primeuix/themes/aura';
import { providePrimeNG } from 'primeng/config';
import { firstValueFrom } from 'rxjs';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { loadingInterceptor } from './core/interceptors/loading.interceptor';
import { AuthService } from './core/services/auth.service';
import { EquipmentDefinitionsStore } from './core/services/equipment-definitions.store';

function initializeAuthFactory(auth: AuthService) {
  return () => {
    auth.initializeFromStorage();
    return Promise.resolve();
  };
}

function loadAppCatalogFactory(
  equipmentDefinitions: EquipmentDefinitionsStore,
  auth: AuthService
) {
  return () => {
    if (!auth.isAuthenticated()) {
      return Promise.resolve();
    }
    return firstValueFrom(equipmentDefinitions.load());
  };
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor, loadingInterceptor])),
    providePrimeNG({
      theme: {
        preset: Aura,
        options: {
          darkModeSelector: false,
          cssLayer: false
        }
      },
      ripple: false,
      translation: {
        dayNames: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'],
        dayNamesShort: ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"],
        dayNamesMin: ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'],
        monthNames: [
          'ינואר',
          'פברואר',
          'מרץ',
          'אפריל',
          'מאי',
          'יוני',
          'יולי',
          'אוגוסט',
          'ספטמבר',
          'אוקטובר',
          'נובמבר',
          'דצמבר'
        ],
        monthNamesShort: [
          'ינו',
          'פבר',
          'מרץ',
          'אפר',
          'מאי',
          'יוני',
          'יולי',
          'אוג',
          'ספט',
          'אוק',
          'נוב',
          'דצמ'
        ],
        today: 'היום',
        clear: 'נקה',
        weekHeader: 'שבוע',
        firstDayOfWeek: 0,
        dateFormat: 'dd/mm/yy',
        emptyMessage: 'לא נמצאו תוצאות',
        emptyFilterMessage: 'לא נמצאו תוצאות',
        selectionMessage: '{0} פריטים נבחרו',
        emptySelectionMessage: 'לא נבחרו פריטים',
        emptySearchMessage: 'לא נמצאו תוצאות',
        choose: 'בחרו',
        searchMessage: '{0} תוצאות זמינות'
      }
    }),
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: initializeAuthFactory,
      deps: [AuthService]
    },
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: loadAppCatalogFactory,
      deps: [EquipmentDefinitionsStore, AuthService]
    },
    { provide: LOCALE_ID, useValue: 'he-IL' },
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};
