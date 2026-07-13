import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { ToolLoanDto, ToolLoanItemDto } from '../../core/models/tools-workspace.model';
import { DataService } from '../../core/services/data.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import {
  formatBillableDuration,
  toBillableParts
} from '../../core/utils/tools-billable-duration';

interface ReturnRowView {
  rowKey: string;
  loanId: number;
  itemId: number;
  item: ToolLoanItemDto;
  clientName: string;
  phone: string;
  lentAt: Date;
  deadlineAt: Date | null;
  returnedAt: Date | null;
  hebrewReturnedDisplay: string | null;
  returning: boolean;
}

@Component({
  selector: 'app-tools-returns',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './tools-returns.component.html',
  styleUrl: './tools-returns.component.scss'
})
export class ToolsReturnsComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly pageTitle = inject(WorkspaceUiService).title('החזרות מהירות');

  protected readonly loading = signal(true);
  protected readonly loans = signal<ToolLoanDto[]>([]);
  protected readonly returningItemId = signal<number | null>(null);
  protected readonly nowTick = signal(Date.now());

  protected readonly rows = computed(() => {
    this.nowTick();
    const views: ReturnRowView[] = [];

    for (const loan of this.loans()) {
      const lentAt = new Date(loan.lentAt);
      const deadlineAt = loan.deadlineAt ? new Date(loan.deadlineAt) : null;

      for (const item of loan.items) {
        const returnedAt = item.returnedAt ? new Date(item.returnedAt) : null;
        views.push({
          rowKey: `${loan.id}-${item.id}`,
          loanId: loan.id,
          itemId: item.id,
          item,
          clientName: loan.clientName,
          phone: loan.phone,
          lentAt,
          deadlineAt,
          returnedAt,
          hebrewReturnedDisplay: item.hebrewReturnedDisplay ?? null,
          returning: this.returningItemId() === item.id
        });
      }
    }

    // Open items first, then recently returned ones from the same batch.
    return views.sort((a, b) => {
      const aOpen = a.returnedAt ? 1 : 0;
      const bOpen = b.returnedAt ? 1 : 0;
      if (aOpen !== bOpen) {
        return aOpen - bOpen;
      }
      return b.lentAt.getTime() - a.lentAt.getTime();
    });
  });

  ngOnInit(): void {
    this.refresh();
    interval(60_000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.nowTick.set(Date.now()));
  }

  protected refresh(): void {
    this.loading.set(true);
    this.data
      .getActiveToolLoans()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe((list) => {
        // Keep locally returned sibling items visible while the loan still has open items,
        // and keep fully-returned loans that were just completed in this session.
        const previous = this.loans();
        const byId = new Map(list.map((l) => [l.id, l]));

        for (const prev of previous) {
          const next = byId.get(prev.id);
          if (!next) {
            const hasSessionReturns = prev.items.some((i) => !!i.returnedAt);
            if (hasSessionReturns) {
              byId.set(prev.id, prev);
            }
            continue;
          }

          const mergedItems = next.items.map((item) => {
            const prevItem = prev.items.find((p) => p.id === item.id);
            if (item.returnedAt || !prevItem?.returnedAt) {
              return item;
            }
            return prevItem;
          });
          byId.set(prev.id, { ...next, items: mergedItems });
        }

        this.loans.set(
          Array.from(byId.values()).sort(
            (a, b) => new Date(b.lentAt).getTime() - new Date(a.lentAt).getTime()
          )
        );
      });
  }

  protected formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
  }

  protected formatDeadline(deadline: Date | null): string {
    if (!deadline) {
      return '';
    }
    const hh = String(deadline.getHours()).padStart(2, '0');
    const mm = String(deadline.getMinutes()).padStart(2, '0');
    return `${this.hebrew.toHebrew(deadline)} ${hh}:${mm}`;
  }

  protected durationText(row: ReturnRowView): string {
    const end = row.returnedAt ?? new Date(this.nowTick());
    return formatBillableDuration(toBillableParts(row.lentAt, end));
  }

  protected isOverdue(row: ReturnRowView): boolean {
    if (!row.deadlineAt) {
      return false;
    }
    const end = row.returnedAt ?? new Date(this.nowTick());
    return end.getTime() > row.deadlineAt.getTime();
  }

  protected onReturnedToggle(row: ReturnRowView, checked: boolean): void {
    if (!checked || row.returnedAt) {
      return;
    }

    const stamp = new Date();
    const hebrew = this.formatHebrewDateTime(stamp);
    this.returningItemId.set(row.itemId);

    this.loans.update((list) =>
      list.map((loan) =>
        loan.id !== row.loanId
          ? loan
          : {
              ...loan,
              items: loan.items.map((item) =>
                item.id !== row.itemId
                  ? item
                  : {
                      ...item,
                      returnedAt: stamp.toISOString(),
                      hebrewReturnedDisplay: hebrew
                    }
              )
            }
      )
    );

    this.data
      .returnToolLoanItem(row.loanId, row.itemId, { hebrewReturnedDisplay: hebrew })
      .pipe(finalize(() => this.returningItemId.set(null)))
      .subscribe((updated) => {
        if (!updated) {
          this.refresh();
          return;
        }
        this.toast.success('ההחזרה נרשמה לפריט');
        this.loans.update((list) => {
          const others = list.filter((loan) => loan.id !== updated.id);
          return [updated, ...others].sort(
            (a, b) => new Date(b.lentAt).getTime() - new Date(a.lentAt).getTime()
          );
        });
      });
  }

  private formatHebrewDateTime(date: Date): string {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${this.hebrew.toHebrew(date)} ${hh}:${mm}:${ss}`;
  }
}
