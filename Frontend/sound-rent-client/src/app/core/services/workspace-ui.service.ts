import { computed, inject, Injectable, Signal } from '@angular/core';

import { workspacePageTitle } from '../models/enums';
import { SystemContextService } from './system-context.service';

/** Shared page headings that follow the active Tools/Library workspace. */
@Injectable({ providedIn: 'root' })
export class WorkspaceUiService {
  private readonly systemContext = inject(SystemContextService);

  title(base: string): Signal<string> {
    return computed(() => workspacePageTitle(base, this.systemContext.currentSystemType()));
  }
}
