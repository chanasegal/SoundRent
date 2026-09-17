import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable, fromEvent, merge } from 'rxjs';
import { debounceTime, filter, map } from 'rxjs/operators';

export interface LiveDataRefreshOptions {
  /** Skip a tick when true (modal open, in-flight save, focused input, etc.). */
  skipWhen?: () => boolean;
  /** Refetch when the tab/window becomes visible again. Default true. */
  refreshOnVisible?: boolean;
}

type RefreshTrigger = 'visible' | 'focus';

/**
 * Keeps client lists in sync with the central API across devices/screens
 * without a full page reload:
 * - refetches immediately when the tab or window becomes visible/focused
 *
 * Does not poll on a timer; user actions and local sync events still drive refreshes.
 */
export function startLiveDataRefresh(
  destroyRef: DestroyRef,
  refresh: () => void,
  options: LiveDataRefreshOptions = {}
): void {
  const skipWhen = options.skipWhen ?? (() => false);
  const refreshOnVisible = options.refreshOnVisible !== false;

  if (!refreshOnVisible) {
    return;
  }

  const run = (): void => {
    if (typeof document !== 'undefined' && document.hidden) {
      return;
    }
    if (skipWhen()) {
      return;
    }
    refresh();
  };

  const sources: Observable<RefreshTrigger>[] = [];

  if (typeof document !== 'undefined') {
    sources.push(
      fromEvent(document, 'visibilitychange').pipe(
        filter(() => document.visibilityState === 'visible'),
        map((): RefreshTrigger => 'visible')
      )
    );
  }

  if (typeof window !== 'undefined') {
    sources.push(fromEvent(window, 'focus').pipe(map((): RefreshTrigger => 'focus')));
  }

  if (sources.length === 0) {
    return;
  }

  merge(...sources)
    .pipe(debounceTime(250), takeUntilDestroyed(destroyRef))
    .subscribe(() => run());
}
