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
import { routes } from './app.routes';
import { firstValueFrom } from 'rxjs';

function loadAppCatalogFactory(equipmentDefinitions: EquipmentDefinitionsStore) {
  return () => firstValueFrom(equipmentDefinitions.load());
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
      deps: [EquipmentDefinitionsStore]
    },
    { provide: LOCALE_ID, useValue: 'he-IL' },
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    })
  ]
};
