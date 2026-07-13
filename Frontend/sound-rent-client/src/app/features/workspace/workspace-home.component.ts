import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { SYSTEM_TYPE_LABELS } from '../../core/models/enums';
import { SystemContextService } from '../../core/services/system-context.service';

/**
 * Blank homepage for a Tools / Library workspace shell.
 * Intentionally minimal — each workspace is a standalone site entry point.
 */
@Component({
  selector: 'app-workspace-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto flex min-h-[50vh] max-w-3xl flex-col items-center justify-center px-4 py-16 text-center">
      <h1 class="mt-2 text-3xl font-bold text-[#002244]">{{ title() }}</h1>
    </div>
  `
})

export class WorkspaceHomeComponent {
  private readonly systemContext = inject(SystemContextService);

  protected readonly title = computed(
    () => SYSTEM_TYPE_LABELS[this.systemContext.currentSystemType()]
  );
}
