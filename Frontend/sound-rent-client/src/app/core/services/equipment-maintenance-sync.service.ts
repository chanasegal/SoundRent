import { Injectable, signal } from '@angular/core';

/**
 * Bumps when a booking slot maintenance flag changes so other screens can refetch definitions.
 */
@Injectable({ providedIn: 'root' })
export class EquipmentMaintenanceSyncService {
  private readonly _version = signal(0);
  readonly version = this._version.asReadonly();

  notifyMaintenanceChanged(): void {
    this._version.update((v) => v + 1);
  }
}
