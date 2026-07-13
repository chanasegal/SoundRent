import { inject } from '@angular/core';
import { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/guards/auth.guard';
import { SystemType } from './core/models/enums';
import { SystemContextService } from './core/services/system-context.service';
import { LayoutComponent } from './shared/layout/layout.component';
import { WorkspaceShellComponent } from './shared/layout/workspace-shell.component';

const libraryChildren: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/workspace/workspace-home.component').then((m) => m.WorkspaceHomeComponent)
  },
  {
    path: 'customers',
    loadComponent: () =>
      import('./features/admin/customers-admin.component').then((m) => m.CustomersAdminComponent)
  }
];

const toolsChildren: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'lending'
  },
  {
    path: 'lending',
    loadComponent: () =>
      import('./features/tools/tools-lending.component').then((m) => m.ToolsLendingComponent)
  },
  {
    path: 'returns',
    loadComponent: () =>
      import('./features/tools/tools-returns.component').then((m) => m.ToolsReturnsComponent)
  },
  {
    path: 'inventory',
    loadComponent: () =>
      import('./features/tools/tools-inventory.component').then((m) => m.ToolsInventoryComponent)
  },
  {
    path: 'customers',
    loadComponent: () =>
      import('./features/admin/customers-admin.component').then((m) => m.CustomersAdminComponent)
  }
];

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/login.component').then((m) => m.LoginComponent)
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: () => inject(SystemContextService).workspaceHomePath()
  },
  {
    path: 'tools',
    component: WorkspaceShellComponent,
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    data: { systemType: SystemType.Tools },
    children: toolsChildren
  },
  {
    path: 'library',
    component: WorkspaceShellComponent,
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    data: { systemType: SystemType.Library },
    children: libraryChildren
  },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    canActivateChild: [authGuard],
    data: { systemType: SystemType.Sound },
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/weekly-grid/weekly-grid.component').then((m) => m.WeeklyGridComponent)
      },
      {
        path: 'admin/equipment-report',
        loadComponent: () =>
          import('./features/admin/daily-equipment-report.component').then(
            (m) => m.DailyEquipmentReportComponent
          )
      },
      {
        path: 'admin/quick-loan',
        loadComponent: () =>
          import('./features/admin/quick-loan.component').then((m) => m.QuickLoanComponent)
      },
      {
        path: 'orders/new',
        loadComponent: () =>
          import('./features/order-form/order-form.component').then((m) => m.OrderFormComponent)
      },
      {
        path: 'orders/:id',
        loadComponent: () =>
          import('./features/order-form/order-form.component').then((m) => m.OrderFormComponent)
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
      {
        path: 'admin/lost-equipment',
        loadComponent: () =>
          import('./features/admin/lost-equipment-admin.component').then(
            (m) => m.LostEquipmentAdminComponent
          )
      },
      {
        path: 'admin/unreturned-items',
        loadComponent: () =>
          import('./features/admin/unreturned-items-admin.component').then(
            (m) => m.UnreturnedItemsAdminComponent
          )
      },
      {
        path: 'admin/blocked-dates',
        loadComponent: () =>
          import('./features/admin/blocked-dates-admin.component').then(
            (m) => m.BlockedDatesAdminComponent
          )
      },
      {
        path: 'reports',
        loadComponent: () =>
          import('./features/reports/reports-view.component').then((m) => m.ReportsViewComponent)
      }
    ]
  },
  { path: '**', redirectTo: 'dashboard' }
];
