import { computed, inject, Injectable, signal } from '@angular/core';
import { finalize, map, Observable, of, shareReplay, tap } from 'rxjs';

import { InventoryDefinitionDto } from '../models/inventory-definition.model';
import { LOANED_EQUIPMENT_LABELS, LOANED_EQUIPMENT_ORDER, LoanedEquipmentType } from '../models/enums';
import { DataService } from './data.service';

export interface InventoryDefinitionsLoadOptions {
  force?: boolean;
}

/** Linked system accessory type for loan / lookup UIs. */
export interface LinkedAccessoryTypeOption {
  type: LoanedEquipmentType;
  label: string;
  inventoryDefinitionId: number | null;
}

@Injectable({ providedIn: 'root' })
export class InventoryDefinitionsStore {
  private readonly data = inject(DataService);

  /** All inventory catalog rows, always sorted A–Z by Hebrew display name. */
  readonly definitions = signal<InventoryDefinitionDto[]>([]);

  /** Linked system types only, sorted A–Z by display label. */
  readonly linkedTypeOptions = computed(() => this.buildLinkedTypeOptions(this.definitions()));

  private loaded = false;
  private loadInFlight: Observable<void> | null = null;

  load(options?: InventoryDefinitionsLoadOptions): Observable<void> {
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

    this.loadInFlight = this.data.getInventoryDefinitions().pipe(
      tap((rows) => {
        this.replaceAll(rows ?? []);
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

  /** Replace the full catalog (e.g. after a batch save). */
  replaceAll(rows: InventoryDefinitionDto[]): void {
    this.definitions.set(this.sortByDisplayName(rows));
    this.loaded = true;
  }

  upsert(dto: InventoryDefinitionDto): void {
    this.definitions.update((rows) => {
      const idx = rows.findIndex((d) => d.id === dto.id);
      const next = idx >= 0 ? rows.map((r, i) => (i === idx ? { ...r, ...dto } : r)) : [...rows, dto];
      return this.sortByDisplayName(next);
    });
    this.loaded = true;
  }

  remove(id: number): void {
    this.definitions.update((rows) => rows.filter((d) => d.id !== id));
  }

  byId(id: number): InventoryDefinitionDto | undefined {
    return this.definitions().find((d) => d.id === id);
  }

  displayLabelForType(type: LoanedEquipmentType): string {
    const linked = this.definitions().find((d) => d.linkedEquipmentType === type);
    return linked?.displayName?.trim() || LOANED_EQUIPMENT_LABELS[type] || String(type);
  }

  /**
   * Sorted linked-type options. When the store is still empty (before first load),
   * falls back to the static enum labels so dropdowns are never blank.
   */
  private buildLinkedTypeOptions(defs: InventoryDefinitionDto[]): LinkedAccessoryTypeOption[] {
    const byType = new Map<LoanedEquipmentType, LinkedAccessoryTypeOption>();

    for (const def of defs) {
      const linked = def.linkedEquipmentType;
      if (!linked || !LOANED_EQUIPMENT_ORDER.includes(linked as LoanedEquipmentType)) {
        continue;
      }
      const type = linked as LoanedEquipmentType;
      byType.set(type, {
        type,
        label: def.displayName?.trim() || LOANED_EQUIPMENT_LABELS[type],
        inventoryDefinitionId: def.id
      });
    }

    if (byType.size === 0) {
      return [...LOANED_EQUIPMENT_ORDER]
        .map((type) => ({
          type,
          label: LOANED_EQUIPMENT_LABELS[type],
          inventoryDefinitionId: null as number | null
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'he'));
    }

    // Ensure every system type is represented even if a seed row is missing.
    for (const type of LOANED_EQUIPMENT_ORDER) {
      if (!byType.has(type)) {
        byType.set(type, {
          type,
          label: LOANED_EQUIPMENT_LABELS[type],
          inventoryDefinitionId: null
        });
      }
    }

    return [...byType.values()].sort((a, b) => a.label.localeCompare(b.label, 'he'));
  }

  private sortByDisplayName(rows: InventoryDefinitionDto[]): InventoryDefinitionDto[] {
    return [...rows].sort((a, b) =>
      (a.displayName ?? '').localeCompare(b.displayName ?? '', 'he', { sensitivity: 'base' })
    );
  }
}
