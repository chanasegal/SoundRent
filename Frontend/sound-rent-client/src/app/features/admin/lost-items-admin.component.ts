import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import { LostEquipmentAdminComponent } from './lost-equipment-admin.component';
import { UnreturnedItemsAdminComponent } from './unreturned-items-admin.component';

export type LostItemsTab = 'forgotten' | 'unreturned';

@Component({
  selector: 'app-lost-items-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LostEquipmentAdminComponent, UnreturnedItemsAdminComponent],
  templateUrl: './lost-items-admin.component.html',
  styleUrl: './lost-items-admin.component.scss'
})
export class LostItemsAdminComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly pageTitle = inject(WorkspaceUiService).title('אבידות');
  protected readonly activeTab = signal<LostItemsTab>(this.readTabFromUrl());

  constructor() {
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.activeTab.set(this.parseTab(params.get('tab')));
    });
  }

  protected switchTab(tab: LostItemsTab): void {
    if (this.activeTab() === tab) {
      return;
    }
    this.activeTab.set(tab);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'forgotten' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  private readTabFromUrl(): LostItemsTab {
    return this.parseTab(this.route.snapshot.queryParamMap.get('tab'));
  }

  private parseTab(value: string | null): LostItemsTab {
    return value === 'unreturned' ? 'unreturned' : 'forgotten';
  }
}
