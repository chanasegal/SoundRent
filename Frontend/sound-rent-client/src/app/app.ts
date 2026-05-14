import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

import { SpinnerComponent } from './shared/spinner/spinner.component';
import { ToasterComponent } from './shared/toaster/toaster.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SpinnerComponent, ToasterComponent],
  template: `
    <router-outlet></router-outlet>
    <app-spinner></app-spinner>
    <app-toaster></app-toaster>
  `
})
export class App {}
