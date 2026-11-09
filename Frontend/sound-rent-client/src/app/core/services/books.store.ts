import { computed, inject, Injectable, signal } from '@angular/core';
import { finalize, map, Observable, of, shareReplay, tap } from 'rxjs';

import { BookDto, BookTitleOption } from '../models/library-workspace.model';
import {
  BOOK_TITLE_SUGGEST_LIMIT,
  buildBookSearchIndex,
  filterBookTitles
} from '../utils/book-title-search';
import { DataService } from './data.service';

export interface BooksLoadOptions {
  force?: boolean;
  /** When true, fetch id+title only (no copy arrays). Use for pickers / returns / lending search. */
  titlesOnly?: boolean;
}

export interface BookSuggestOptions {
  limit?: number;
  excludeIds?: ReadonlySet<number>;
  keepId?: number | null;
}

@Injectable({ providedIn: 'root' })
export class BooksStore {
  private readonly data = inject(DataService);

  /** All books, always sorted A–Z by Hebrew title. */
  readonly definitions = signal<BookDto[]>([]);

  /** Slim id+title rows for pickers. */
  readonly titleOptions = computed<BookTitleOption[]>(() =>
    this.definitions().map((d) => ({ id: d.id, title: d.title }))
  );

  /** Pre-lowercased index for O(n) local typeahead without repeated toLowerCase(). */
  readonly searchIndex = computed(() => buildBookSearchIndex(this.definitions()));

  private loaded = false;
  private titlesOnlyLoaded = false;
  private loadInFlight: Observable<void> | null = null;
  private readonly copiesInFlight = new Map<number, Observable<string[]>>();

  load(options?: BooksLoadOptions): Observable<void> {
    const force = options?.force === true;
    const titlesOnly = options?.titlesOnly === true;

    if (!force) {
      if (titlesOnly && (this.loaded || this.titlesOnlyLoaded)) {
        return of(undefined);
      }
      if (!titlesOnly && this.loaded) {
        return of(undefined);
      }
      if (this.loadInFlight) {
        return this.loadInFlight;
      }
    }

    if (force) {
      this.loadInFlight = null;
    }

    const request$ = titlesOnly
      ? this.data.getBookTitles().pipe(
          tap((rows) => {
            this.replaceTitles(rows ?? []);
            this.titlesOnlyLoaded = true;
          })
        )
      : this.data.getBooks().pipe(
          tap((rows) => {
            this.replaceAll(rows ?? []);
            this.loaded = true;
            this.titlesOnlyLoaded = true;
          })
        );

    this.loadInFlight = request$.pipe(
      map(() => undefined),
      finalize(() => {
        this.loadInFlight = null;
      }),
      shareReplay(1)
    );
    return this.loadInFlight;
  }

  /**
   * Local typeahead filter (tools-style architecture) with a hard result cap
   * so large book catalogs stay as responsive as the small tools catalog.
   */
  suggest(query: string, options?: BookSuggestOptions): BookTitleOption[] {
    return filterBookTitles(this.searchIndex(), query, {
      limit: options?.limit ?? BOOK_TITLE_SUGGEST_LIMIT,
      excludeIds: options?.excludeIds,
      keepId: options?.keepId
    });
  }

  /**
   * Ensure copy numbers for a book are in the local cache.
   * No-op when the full catalog (or this book) already has copies loaded.
   */
  ensureCopies(bookId: number): Observable<string[]> {
    if (bookId <= 0) {
      return of([]);
    }

    const existing = this.definitions().find((d) => d.id === bookId);
    if (existing && existing.copies.length > 0) {
      return of(existing.copies);
    }
    if (existing && this.loaded && existing.totalQuantity === 0) {
      return of([]);
    }

    const inflight = this.copiesInFlight.get(bookId);
    if (inflight) {
      return inflight;
    }

    const req$ = this.data.getBookCopyNumbers(bookId).pipe(
      tap((copies) => {
        this.patchCopies(bookId, copies ?? []);
      }),
      finalize(() => {
        this.copiesInFlight.delete(bookId);
      }),
      shareReplay(1)
    );
    this.copiesInFlight.set(bookId, req$);
    return req$;
  }

  invalidate(): void {
    this.loaded = false;
    this.titlesOnlyLoaded = false;
    this.loadInFlight = null;
    this.copiesInFlight.clear();
  }

  replaceAll(rows: BookDto[]): void {
    this.definitions.set(this.sortByTitle(rows));
    this.loaded = true;
    this.titlesOnlyLoaded = true;
  }

  replaceTitles(rows: BookTitleOption[]): void {
    const prevById = new Map(this.definitions().map((d) => [d.id, d]));
    const next: BookDto[] = rows.map((row) => {
      const prev = prevById.get(row.id);
      return {
        id: row.id,
        title: row.title,
        author: prev?.author ?? null,
        category: prev?.category ?? null,
        sortOrder: prev?.sortOrder ?? 0,
        totalQuantity: prev?.totalQuantity ?? prev?.copies.length ?? 0,
        copies: prev?.copies ?? []
      };
    });
    this.definitions.set(this.sortByTitle(next));
    this.titlesOnlyLoaded = true;
  }

  upsert(dto: BookDto): void {
    this.definitions.update((rows) => {
      const idx = rows.findIndex((d) => d.id === dto.id);
      const next = idx >= 0 ? rows.map((r, i) => (i === idx ? { ...r, ...dto } : r)) : [...rows, dto];
      return this.sortByTitle(next);
    });
    this.loaded = true;
    this.titlesOnlyLoaded = true;
  }

  remove(id: number): void {
    this.definitions.update((rows) => rows.filter((d) => d.id !== id));
  }

  byId(id: number): BookDto | undefined {
    return this.definitions().find((d) => d.id === id);
  }

  private patchCopies(bookId: number, copies: string[]): void {
    this.definitions.update((rows) =>
      rows.map((row) =>
        row.id === bookId ? { ...row, copies, totalQuantity: copies.length } : row
      )
    );
  }

  private sortByTitle(rows: BookDto[]): BookDto[] {
    return [...rows].sort((a, b) =>
      (a.title ?? '').localeCompare(b.title ?? '', 'he', { sensitivity: 'base' })
    );
  }
}
