import { inject, Injectable, signal } from '@angular/core';
import { finalize, map, Observable, of, shareReplay, tap } from 'rxjs';

import { EquipmentDefinitionDto } from '../models/equipment-definition.model';
import { SystemType } from '../models/enums';
import { DataService } from './data.service';
import { SystemContextService } from './system-context.service';

export interface EquipmentDefinitionsLoadOptions {
  force?: boolean;
}

@Injectable({ providedIn: 'root' })
export class EquipmentDefinitionsStore {
  private readonly data = inject(DataService);
  private readonly systemContext = inject(SystemContextService);

  readonly definitions = signal<EquipmentDefinitionDto[]>([]);

  private loaded = false;
  private loadedForSystem: SystemType | null = null;
  private loadInFlight: Observable<void> | null = null;

  load(options?: EquipmentDefinitionsLoadOptions): Observable<void> {
    const force = options?.force === true;
    const system = this.systemContext.currentSystemType();
    if (this.loaded && !force && this.loadedForSystem === system) {
      return of(undefined);
    }
    if (this.loadInFlight && !force && this.loadedForSystem === system) {
      return this.loadInFlight;
    }

    if (force) {
      this.loadInFlight = null;
    }

    this.loadInFlight = this.data.getEquipmentDefinitions().pipe(
      tap((rows) => {
        this.definitions.set(rows ?? []);
        this.loaded = true;
        this.loadedForSystem = system;
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
    this.loadedForSystem = null;
    this.loadInFlight = null;
  }

  /** Booking columns for the active Tools/Library workspace. */
  boardSlotDefinitions(): EquipmentDefinitionDto[] {
    return this.definitions();
  }

  static isBoardColumnCategory(category: string | null | undefined): boolean {
    return category === 'Speakers' || category === 'Projectors';
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

  upsertDefinitions(dtos: EquipmentDefinitionDto[]): void {
    if (dtos.length === 0) {
      return;
    }
    this.definitions.update((rows) => {
      const byId = new Map(rows.map((d) => [d.id, d] as const));
      for (const dto of dtos) {
        byId.set(dto.id, dto);
      }
      return [...byId.values()].sort((a, b) => a.sortOrder - b.sortOrder);
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
    return this.boardSlotDefinitions().some((d) => d.id === t);
  }

  /** First speaker slot not in maintenance; falls back to any speaker slot if all are in maintenance. */
  firstAvailableSpeakerSlotId(): string {
    const speakers = this.boardSlotDefinitions();
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
    return this.boardSlotDefinitions()[0]?.id ?? this.definitions()[0]?.id ?? '';
  }
}
