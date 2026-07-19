import { inject, Injectable, signal } from '@angular/core';
import { finalize, map, Observable, of, shareReplay, tap } from 'rxjs';

import { BookDto } from '../models/library-workspace.model';
import { DataService } from './data.service';

export interface BooksLoadOptions {
  force?: boolean;
}

@Injectable({ providedIn: 'root' })
export class BooksStore {
  private readonly data = inject(DataService);

  /** All books, always sorted A–Z by Hebrew title. */
  readonly definitions = signal<BookDto[]>([]);

  private loaded = false;
  private loadInFlight: Observable<void> | null = null;

  load(options?: BooksLoadOptions): Observable<void> {
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

    this.loadInFlight = this.data.getBooks().pipe(
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

  replaceAll(rows: BookDto[]): void {
    this.definitions.set(this.sortByTitle(rows));
    this.loaded = true;
  }

  upsert(dto: BookDto): void {
    this.definitions.update((rows) => {
      const idx = rows.findIndex((d) => d.id === dto.id);
      const next = idx >= 0 ? rows.map((r, i) => (i === idx ? { ...r, ...dto } : r)) : [...rows, dto];
      return this.sortByTitle(next);
    });
    this.loaded = true;
  }

  remove(id: number): void {
    this.definitions.update((rows) => rows.filter((d) => d.id !== id));
  }

  byId(id: number): BookDto | undefined {
    return this.definitions().find((d) => d.id === id);
  }

  private sortByTitle(rows: BookDto[]): BookDto[] {
    return [...rows].sort((a, b) =>
      (a.title ?? '').localeCompare(b.title ?? '', 'he', { sensitivity: 'base' })
    );
  }
}
