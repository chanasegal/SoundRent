import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, fromEvent, merge, timer } from 'rxjs';
import { debounceTime, filter, map } from 'rxjs/operators';

/** Default poll cadence for open ops screens (matches weekly grid / inventory). */
export const LIVE_DATA_REFRESH_MS = 15_000;

export interface LiveDataRefreshOptions {
  /** Poll interval while the tab is visible. Default {@link LIVE_DATA_REFRESH_MS}. */
  intervalMs?: number;
  /** Skip a tick when true (modal open, in-flight save, focused input, etc.). */
  skipWhen?: () => boolean;
  /** Refetch when the tab/window becomes visible again. Default true. */
  refreshOnVisible?: boolean;
}

type RefreshTrigger = 'poll' | 'visible' | 'focus';

/**
 * Keeps client lists in sync with the central API across devices/screens
 * without a full page reload:
 * - polls while the document is visible
 * - refetches immediately when the tab or window becomes visible/focused
 */
export function startLiveDataRefresh(
  destroyRef: DestroyRef,
  refresh: () => void,
  options: LiveDataRefreshOptions = {}
): void {
  const intervalMs = options.intervalMs ?? LIVE_DATA_REFRESH_MS;
  const skipWhen = options.skipWhen ?? (() => false);
  const refreshOnVisible = options.refreshOnVisible !== false;

  const run = (): void => {
    if (typeof document !== 'undefined' && document.hidden) {
      return;
    }
    if (skipWhen()) {
      return;
    }
    refresh();
  };

  const sources: Observable<RefreshTrigger>[] = [
    timer(intervalMs, intervalMs).pipe(map((): RefreshTrigger => 'poll'))
  ];

  if (refreshOnVisible && typeof document !== 'undefined') {
    sources.push(
      fromEvent(document, 'visibilitychange').pipe(
        filter(() => document.visibilityState === 'visible'),
        map((): RefreshTrigger => 'visible')
      )
    );
  }

  if (refreshOnVisible && typeof window !== 'undefined') {
    sources.push(fromEvent(window, 'focus').pipe(map((): RefreshTrigger => 'focus')));
  }

  merge(...sources)
    .pipe(debounceTime(250), takeUntilDestroyed(destroyRef))
    .subscribe(() => run());
}
