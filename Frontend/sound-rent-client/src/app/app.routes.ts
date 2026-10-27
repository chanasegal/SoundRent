import { inject } from '@angular/core';
import { Router, Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/guards/auth.guard';
import { canDeactivateGuard } from './core/guards/can-deactivate.guard';
import { SystemType } from './core/models/enums';
import { SystemContextService } from './core/services/system-context.service';
import { LayoutComponent } from './shared/layout/layout.component';
import { WorkspaceShellComponent } from './shared/layout/workspace-shell.component';

/** Cross-workspace cash deposits ledger, reachable from every workspace header. */
const depositsRoute: Routes[number] = {
  path: 'deposits',
  loadComponent: () =>
    import('./features/deposits/cash-deposits.component').then((m) => m.CashDepositsComponent)
};

const libraryChildren: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'lending'
  },
  {
    path: 'lending',
    loadComponent: () =>
      import('./features/library/library-lending.component').then((m) => m.LibraryLendingComponent)
  },
  {
    path: 'returns',
    loadComponent: () =>
      import('./features/library/library-returns.component').then((m) => m.LibraryReturnsComponent)
  },
  {
    path: 'inventory',
    loadComponent: () =>
      import('./features/library/library-inventory.component').then((m) => m.LibraryInventoryComponent)
  },
  {
    path: 'customers',
    loadComponent: () =>
      import('./features/admin/customers-admin.component').then((m) => m.CustomersAdminComponent)
  },
  {
    path: 'reports',
    loadComponent: () =>
      import('./features/library/library-reports.component').then((m) => m.LibraryReportsComponent)
  },
  depositsRoute
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
    path: 'accessory-lending',
    loadComponent: () =>
      import('./features/admin/quick-loan.component').then((m) => m.QuickLoanComponent)
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
  },
  {
    path: 'reports',
    loadComponent: () =>
      import('./features/tools/tools-reports.component').then((m) => m.ToolsReportsComponent)
  },
  depositsRoute
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
        canDeactivate: [canDeactivateGuard],
        loadComponent: () =>
          import('./features/admin/daily-equipment-report.component').then(
            (m) => m.DailyEquipmentReportComponent
          )
      },
      {
        path: 'admin/quick-loan',
        redirectTo: '/tools/accessory-lending'
      },
      {
        path: 'admin/loans',
        loadComponent: () =>
          import('./features/admin/active-loans.component').then((m) => m.ActiveLoansComponent)
      },
      {
        path: 'admin/returns',
        loadComponent: () =>
          import('./features/admin/accessory-returns.component').then(
            (m) => m.AccessoryReturnsComponent
          )
      },
      {
        path: 'orders/new',
        canDeactivate: [canDeactivateGuard],
        loadComponent: () =>
          import('./features/order-form/order-form.component').then((m) => m.OrderFormComponent)
      },
      {
        path: 'orders/:id',
        canDeactivate: [canDeactivateGuard],
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
        path: 'admin/lost-items',
        loadComponent: () =>
          import('./features/admin/lost-items-admin.component').then(
            (m) => m.LostItemsAdminComponent
          )
      },
      {
        path: 'admin/lost-equipment',
        redirectTo: 'admin/lost-items',
        pathMatch: 'full'
      },
      {
        path: 'admin/unreturned-items',
        pathMatch: 'full',
        redirectTo: () =>
          inject(Router).createUrlTree(['/admin/lost-items'], {
            queryParams: { tab: 'unreturned' }
          })
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
      },
      depositsRoute
    ]
  },
  { path: '**', redirectTo: 'dashboard' }
];
