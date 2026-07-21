import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { OrderDraftBarComponent } from './shared/order-draft-bar/order-draft-bar.component';
import { SpinnerComponent } from './shared/spinner/spinner.component';
import { ToasterComponent } from './shared/toaster/toaster.component';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, SpinnerComponent, ToasterComponent, OrderDraftBarComponent],
  template: `
    <router-outlet></router-outlet>
    <app-spinner></app-spinner>
    <app-toaster></app-toaster>
    <app-order-draft-bar></app-order-draft-bar>
  `
})
export class App {}
