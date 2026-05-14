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

import { authInterceptor } from './core/interceptors/auth.interceptor';
import { loadingInterceptor } from './core/interceptors/loading.interceptor';
import { EquipmentDefinitionsStore } from './core/services/equipment-definitions.store';
import { LoanedEquipmentNoteDefaultsStore } from './core/services/loaned-equipment-note-defaults.store';
import { routes } from './app.routes';
import { firstValueFrom, forkJoin, map } from 'rxjs';

function loadAppCatalogFactory(
  equipmentDefinitions: EquipmentDefinitionsStore,
  noteDefaults: LoanedEquipmentNoteDefaultsStore
) {
  return () => firstValueFrom(forkJoin([equipmentDefinitions.load(), noteDefaults.load()]).pipe(map(() => void 0)));
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor, loadingInterceptor])),
    {
      provide: APP_INITIALIZER,
      multi: true,
      useFactory: loadAppCatalogFactory,
      deps: [EquipmentDefinitionsStore, LoanedEquipmentNoteDefaultsStore]
    },
    { provide: LOCALE_ID, useValue: 'he-IL' },
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};
