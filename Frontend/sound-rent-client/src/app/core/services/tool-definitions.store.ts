import { inject, Injectable, signal } from '@angular/core';
import { finalize, map, Observable, of, shareReplay, tap } from 'rxjs';

import { ToolDefinitionDto } from '../models/tools-workspace.model';
import { DataService } from './data.service';

export interface ToolDefinitionsLoadOptions {
  force?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ToolDefinitionsStore {
  private readonly data = inject(DataService);

  /** All tool types, always sorted A–Z by Hebrew display name. */
  readonly definitions = signal<ToolDefinitionDto[]>([]);

  private loaded = false;
  private loadInFlight: Observable<void> | null = null;

  load(options?: ToolDefinitionsLoadOptions): Observable<void> {
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

    this.loadInFlight = this.data.getToolDefinitions().pipe(
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

  replaceAll(rows: ToolDefinitionDto[]): void {
    this.definitions.set(this.sortByDisplayName(rows));
    this.loaded = true;
  }

  upsert(dto: ToolDefinitionDto): void {
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

  byId(id: number): ToolDefinitionDto | undefined {
    return this.definitions().find((d) => d.id === id);
  }

  private sortByDisplayName(rows: ToolDefinitionDto[]): ToolDefinitionDto[] {
    return [...rows].sort((a, b) =>
      (a.displayName ?? '').localeCompare(b.displayName ?? '', 'he', { sensitivity: 'base' })
    );
  }
}
