import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';

@Component({
  selector: 'app-header-clock',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <time class="header-clock" [attr.datetime]="isoTime()" aria-label="שעה נוכחית">
      {{ displayTime() }}
    </time>
  `,
  styles: `
    :host {
      display: block;
      flex-shrink: 0;
    }

    .header-clock {
      display: inline-block;
      min-width: 7.25ch;
      padding: 0.35rem 0.65rem;
      border-radius: 0.5rem;
      background: rgb(255 255 255 / 0.08);
      color: #f0f9ff;
      font-size: 0.9375rem;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.04em;
      line-height: 1.25;
      white-space: nowrap;
      direction: ltr;
      unicode-bidi: isolate;
    }
  `
})
export class HeaderClockComponent {
  private readonly now = signal(new Date());

  protected readonly displayTime = computed(() =>
    this.now().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    })
  );

  protected readonly isoTime = computed(() => this.now().toISOString());

  constructor() {
    interval(1000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.now.set(new Date()));
  }
}
