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

  /** Resolve a catalog row by legacy enum label (display-name match). */
  definitionForType(type: LoanedEquipmentType): InventoryDefinitionDto | undefined {
    const label = LOANED_EQUIPMENT_LABELS[type];
    if (!label) {
      return undefined;
    }
    return this.definitions().find(
      (d) =>
        d.displayName.trim().localeCompare(label, 'he', { sensitivity: 'accent' }) === 0
    );
  }

  definitionIdForType(type: LoanedEquipmentType): number | null {
    return this.definitionForType(type)?.id ?? null;
  }

  displayLabelForType(type: LoanedEquipmentType): string {
    return (
      this.definitionForType(type)?.displayName?.trim() ||
      LOANED_EQUIPMENT_LABELS[type] ||
      String(type)
    );
  }

  /**
   * Display name for a loaned accessory line. Catalog rows are keyed by
   * inventoryDefinitionId (loanedEquipmentType may be null for custom catalog types).
   */
  displayLabelForLoanedLine(line: {
    isCustomItem?: boolean;
    customItemName?: string | null;
    inventoryDefinitionId?: number | null;
    loanedEquipmentType?: LoanedEquipmentType | null;
  }): string {
    if (line.isCustomItem) {
      return line.customItemName?.trim() || 'פריט נוסף';
    }

    const definitionId =
      line.inventoryDefinitionId != null && line.inventoryDefinitionId > 0
        ? line.inventoryDefinitionId
        : line.loanedEquipmentType != null
          ? this.definitionIdForType(line.loanedEquipmentType)
          : null;
    const fromCatalog =
      definitionId != null ? this.byId(definitionId)?.displayName?.trim() : '';
    if (fromCatalog) {
      return fromCatalog;
    }

    if (line.loanedEquipmentType != null) {
      return this.displayLabelForType(line.loanedEquipmentType);
    }

    return line.customItemName?.trim() || 'פריט';
  }

  /**
   * Sorted linked-type options. When the store is still empty (before first load),
   * falls back to the static enum labels so dropdowns are never blank.
   */
  private buildLinkedTypeOptions(defs: InventoryDefinitionDto[]): LinkedAccessoryTypeOption[] {
    const byType = new Map<LoanedEquipmentType, LinkedAccessoryTypeOption>();

    for (const type of LOANED_EQUIPMENT_ORDER) {
      const label = LOANED_EQUIPMENT_LABELS[type];
      const def = defs.find(
        (d) =>
          d.displayName.trim().localeCompare(label, 'he', { sensitivity: 'accent' }) === 0
      );
      byType.set(type, {
        type,
        label: def?.displayName?.trim() || label,
        inventoryDefinitionId: def?.id ?? null
      });
    }

    return [...byType.values()].sort((a, b) => a.label.localeCompare(b.label, 'he'));
  }

  private sortByDisplayName(rows: InventoryDefinitionDto[]): InventoryDefinitionDto[] {
    return [...rows].sort((a, b) =>
      (a.displayName ?? '').localeCompare(b.displayName ?? '', 'he', { sensitivity: 'base' })
    );
  }
}
