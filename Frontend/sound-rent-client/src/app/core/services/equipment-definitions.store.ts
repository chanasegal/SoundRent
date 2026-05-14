import { inject, Injectable, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

import { EquipmentDefinitionDto } from '../models/equipment-definition.model';
import { DataService } from './data.service';

@Injectable({ providedIn: 'root' })
export class EquipmentDefinitionsStore {
  private readonly data = inject(DataService);

  readonly definitions = signal<EquipmentDefinitionDto[]>([]);

  load(): Observable<void> {
    return this.data.getEquipmentDefinitions().pipe(
      tap((rows) => {
        this.definitions.set(rows ?? []);
      }),
      map(() => undefined)
    );
  }

  hasSlot(id: string): boolean {
    const t = id.trim();
    return this.definitions().some((d) => d.id === t);
  }

  /** Speaker / console booking slots only (main grid + order slot dropdown). */
  hasSpeakerSlot(id: string): boolean {
    const t = id.trim();
    return this.definitions().some((d) => d.id === t && d.category === 'Speakers');
  }

  /** First speaker slot not in maintenance; falls back to any speaker slot if all are in maintenance. */
  firstAvailableSpeakerSlotId(): string {
    const speakers = this.definitions().filter((d) => d.category === 'Speakers');
    const avail = speakers.find((d) => !d.isUnderMaintenance);
    return avail?.id ?? speakers[0]?.id ?? '';
  }

  applyMaintenancePatch(id: string, isUnderMaintenance: boolean): void {
    const t = id.trim();
    this.definitions.update((rows) =>
      rows.map((d) => (d.id === t ? { ...d, isUnderMaintenance } : d))
    );
  }

  displayLabel(slot: string | null | undefined): string {
    if (!slot) {
      return '';
    }
    const t = slot.trim();
    const row = this.definitions().find((d) => d.id === t);
    return row?.displayName ?? t;
  }

  /** First booking slot used for speaker/console columns only (excludes mic/cable/general extras). */
  firstSlotId(): string {
    const preferred = this.firstAvailableSpeakerSlotId();
    if (preferred.length > 0) {
      return preferred;
    }
    return this.definitions().find((d) => d.category === 'Speakers')?.id ?? this.definitions()[0]?.id ?? '';
  }
}
