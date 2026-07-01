import { CommonModule, DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, finalize } from 'rxjs';

import { DataService } from '../../core/services/data.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-memo-dropdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './memo-dropdown.component.html',
  styleUrl: './memo-dropdown.component.scss'
})
export class MemoDropdownComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  private readonly rootRef = viewChild<ElementRef<HTMLElement>>('memoRoot');

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

    this.document.addEventListener('click', this.onDocumentClick);
    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('click', this.onDocumentClick);
    });
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

  private readonly onDocumentClick = (event: MouseEvent): void => {
    if (!this.open()) {
      return;
    }
    const root = this.rootRef()?.nativeElement;
    if (root && !root.contains(event.target as Node)) {
      this.open.set(false);
    }
  };
}
