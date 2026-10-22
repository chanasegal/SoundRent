import { Injectable, inject } from '@angular/core';
import {
  HttpTransportType,
  HubConnection,
  HubConnectionBuilder,
  IRetryPolicy,
  LogLevel,
  RetryContext
} from '@microsoft/signalr';
import { Observable, share } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

export type ScheduleUpdateSource = 'orders' | 'waitlist' | 'blocked-dates';
export type ScheduleChangeType = 'created' | 'updated' | 'deleted';

/** Payload of the server's `ScheduleUpdated` broadcast. */
export interface ScheduleUpdatedEvent {
  source: ScheduleUpdateSource;
  changeType: ScheduleChangeType;
  entityId: number | null;
}

/**
 * `updated`: another client mutated schedule data.
 * `resync`: the connection was re-established; broadcasts may have been missed while offline.
 */
export type ScheduleHubSignal =
  | { kind: 'updated'; event: ScheduleUpdatedEvent }
  | { kind: 'resync' };

const SCHEDULE_UPDATED_METHOD = 'ScheduleUpdated';
const MAX_RETRY_DELAY_MS = 30_000;

/** Never gives up: 0s, 2s, 4s, 8s … capped at 30s. */
const foreverRetryPolicy: IRetryPolicy = {
  nextRetryDelayInMilliseconds: (ctx: RetryContext) =>
    ctx.previousRetryCount === 0
      ? 0
      : Math.min(MAX_RETRY_DELAY_MS, 1_000 * 2 ** ctx.previousRetryCount)
};

/**
 * Cross-device push channel for the weekly schedule board (ASP.NET Core SignalR `ScheduleHub`).
 * The hub connection is ref-counted: it opens on the first subscriber to {@link signals$}
 * and closes when the last one unsubscribes.
 */
@Injectable({ providedIn: 'root' })
export class ScheduleHubService {
  private readonly auth = inject(AuthService);

  readonly signals$: Observable<ScheduleHubSignal> = new Observable<ScheduleHubSignal>(
    (subscriber) => {
      const connection = this.buildConnection();
      let disposed = false;
      let startAttempt = 0;
      let startRetryTimer: ReturnType<typeof setTimeout> | null = null;

      connection.on(SCHEDULE_UPDATED_METHOD, (event: ScheduleUpdatedEvent) =>
        subscriber.next({ kind: 'updated', event })
      );
      connection.onreconnected(() => subscriber.next({ kind: 'resync' }));
      connection.onclose(() => {
        if (!disposed) {
          scheduleStart();
        }
      });

      // withAutomaticReconnect only covers drops after a successful start, so the
      // initial connect (and any terminal close) is retried here.
      const start = (): void => {
        startRetryTimer = null;
        connection
          .start()
          .then(() => {
            if (startAttempt > 0) {
              subscriber.next({ kind: 'resync' });
            }
            startAttempt = 0;
          })
          .catch(() => {
            if (!disposed) {
              scheduleStart();
            }
          });
      };

      const scheduleStart = (): void => {
        if (startRetryTimer !== null) {
          return;
        }
        const delay = Math.min(MAX_RETRY_DELAY_MS, 2_000 * 2 ** startAttempt);
        startAttempt++;
        startRetryTimer = setTimeout(start, delay);
      };

      start();

      return () => {
        disposed = true;
        if (startRetryTimer !== null) {
          clearTimeout(startRetryTimer);
        }
        void connection.stop();
      };
    }
  ).pipe(share());

  private buildConnection(): HubConnection {
    return new HubConnectionBuilder()
      .withUrl(environment.scheduleHubUrl, {
        accessTokenFactory: () => this.auth.token() ?? '',
        // LongPolling only: NetFree blocks WebSocket upgrades with HTTP 418.
        // skipNegotiation must stay false so negotiate runs over HTTP.
        transport: HttpTransportType.LongPolling,
        skipNegotiation: false
      })
      // Server PollTimeout is 15s; client must wait longer than one empty poll.
      .withServerTimeout(60_000)
      .withKeepAliveInterval(15_000)
      .withAutomaticReconnect(foreverRetryPolicy)
      .configureLogging(environment.production ? LogLevel.Error : LogLevel.Warning)
      .build();
  }
}
