import { inject, Injectable, signal } from '@angular/core';
import { finalize, map, Observable, of, shareReplay, tap } from 'rxjs';

import { EquipmentDefinitionDto } from '../models/equipment-definition.model';
import { DataService } from './data.service';

export interface EquipmentDefinitionsLoadOptions {
  force?: boolean;
}

@Injectable({ providedIn: 'root' })
export class EquipmentDefinitionsStore {
  private readonly data = inject(DataService);

  readonly definitions = signal<EquipmentDefinitionDto[]>([]);

  private loaded = false;
  private loadInFlight: Observable<void> | null = null;

  load(options?: EquipmentDefinitionsLoadOptions): Observable<void> {
    const force = options?.force === true;
    if (this.loaded && !force) {
      return of(undefined);
    }
    if (this.loadInFlight && !force) {
      return this.loadInFlight;
    }

    if (force) {
      this.loadInFlight = null;
    }

    this.loadInFlight = this.data.getEquipmentDefinitions().pipe(
      tap((rows) => {
        this.definitions.set(rows ?? []);
        this.loaded = true;
      }),
      map(() => undefined),
      finalize(() => {
        this.loadInFlight = null;
      }),
      shareReplay(1)
    );
    return this.loadInFlight;
  }

  invalidate(): void {
    this.loaded = false;
    this.loadInFlight = null;
  }

  upsertDefinition(dto: EquipmentDefinitionDto): void {
    this.definitions.update((rows) => {
      const idx = rows.findIndex((d) => d.id === dto.id);
      if (idx >= 0) {
        const next = [...rows];
        next[idx] = dto;
        return next.sort((a, b) => a.sortOrder - b.sortOrder);
      }
      return [...rows, dto].sort((a, b) => a.sortOrder - b.sortOrder);
    });
    this.loaded = true;
  }

  removeDefinition(id: string): void {
    const trimmed = id.trim();
    this.definitions.update((rows) => rows.filter((d) => d.id !== trimmed));
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
