import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/guards/auth.guard';
import { LayoutComponent } from './shared/layout/layout.component';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login.component').then((m) => m.LoginComponent)
  },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/weekly-grid/weekly-grid.component').then(
            (m) => m.WeeklyGridComponent
          )
      },
      {
        path: 'orders/new',
        loadComponent: () =>
          import('./features/order-form/order-form.component').then(
            (m) => m.OrderFormComponent
          )
      },
      {
        path: 'orders/:id',
        loadComponent: () =>
          import('./features/order-form/order-form.component').then(
            (m) => m.OrderFormComponent
          )
      },
      {
        path: 'admin/equipment-slots',
        loadComponent: () =>
          import('./features/admin/equipment-slots-admin.component').then(
            (m) => m.EquipmentSlotsAdminComponent
          )
      },
      {
        path: 'admin/customers',
        loadComponent: () =>
          import('./features/admin/customers-admin.component').then((m) => m.CustomersAdminComponent)
      },
    ]
  },
  { path: '**', redirectTo: 'dashboard' }
];
