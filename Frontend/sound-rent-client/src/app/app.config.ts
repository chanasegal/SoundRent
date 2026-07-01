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
import { AuthService } from './core/services/auth.service';
import { EquipmentDefinitionsStore } from './core/services/equipment-definitions.store';
import { routes } from './app.routes';
import { firstValueFrom } from 'rxjs';

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
