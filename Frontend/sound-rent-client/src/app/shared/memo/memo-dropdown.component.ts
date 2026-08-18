import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, finalize } from 'rxjs';

import { DataService } from '../../core/services/data.service';
import { ToastService } from '../../core/services/toast.service';
import { ClickOutsideDirective } from '../directives/click-outside.directive';

@Component({
  selector: 'app-memo-dropdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, ClickOutsideDirective],
  templateUrl: './memo-dropdown.component.html',
  styleUrl: './memo-dropdown.component.scss'
})
export class MemoDropdownComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly open = signal(false);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly lastSavedAt = signal<string | null>(null);

  protected readonly contentControl = new FormControl('', { nonNullable: true });

  ngOnInit(): void {
    this.loadMemo();

    this.contentControl.valueChanges
      .pipe(debounceTime(600), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.saveMemo(false));
  }

  protected toggle(event: MouseEvent): void {
    event.stopPropagation();
    const next = !this.open();
    this.open.set(next);
    if (next && !this.loading() && this.contentControl.pristine) {
      this.loadMemo();
    }
  }

  protected saveMemo(showToast = true): void {
    if (this.saving()) {
      return;
    }

    this.saving.set(true);
    this.data
      .saveGeneralMemo({ content: this.contentControl.value })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (memo) => {
          if (memo === null) {
            return;
          }
          this.lastSavedAt.set(memo.updatedAt);
          this.contentControl.markAsPristine();
          if (showToast) {
            this.toast.success('התזכיר נשמר');
          }
        }
      });
  }

  private loadMemo(): void {
    this.loading.set(true);
    this.data
      .getGeneralMemo()
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (memo) => {
          if (memo === null) {
            return;
          }
          this.contentControl.setValue(memo.content ?? '', { emitEvent: false });
          this.lastSavedAt.set(memo.updatedAt);
          this.contentControl.markAsPristine();
        }
      });
  }
}
