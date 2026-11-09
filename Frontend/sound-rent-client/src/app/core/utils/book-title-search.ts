import { BookTitleOption } from '../models/library-workspace.model';

/** Cap DOM rows so large catalogs stay as snappy as the small tools catalog. */
export const BOOK_TITLE_SUGGEST_LIMIT = 25;

export interface BookSearchIndexRow {
  id: number;
  title: string;
  titleLower: string;
}

export function buildBookSearchIndex(
  rows: ReadonlyArray<{ id: number; title: string }>
): BookSearchIndexRow[] {
  return rows.map((row) => ({
    id: row.id,
    title: row.title ?? '',
    titleLower: (row.title ?? '').toLowerCase()
  }));
}

/**
 * In-memory title filter with early exit — same architecture as tools lending,
 * but capped so thousands of books never flood the DOM.
 */
export function filterBookTitles(
  index: ReadonlyArray<BookSearchIndexRow>,
  query: string,
  options?: {
    limit?: number;
    excludeIds?: ReadonlySet<number>;
    /** Keep a currently-selected id visible even if it would be excluded. */
    keepId?: number | null;
  }
): BookTitleOption[] {
  const limit = options?.limit ?? BOOK_TITLE_SUGGEST_LIMIT;
  const exclude = options?.excludeIds;
  const keepId = options?.keepId ?? null;
  const q = query.trim().toLowerCase();
  const out: BookTitleOption[] = [];

  for (const row of index) {
    if (exclude?.has(row.id) && row.id !== keepId) {
      continue;
    }
    if (q && !row.titleLower.includes(q)) {
      continue;
    }
    out.push({ id: row.id, title: row.title });
    if (out.length >= limit) {
      break;
    }
  }

  return out;
}
