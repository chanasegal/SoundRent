import { Injectable, computed, signal } from '@angular/core';

export type OrderDraftKind = 'sound-order' | 'tools-loan' | 'library-loan';

/** Parallel UI state for each booking block on the sound order form. */
export interface SoundOrderBookingUiSnapshot {
  occupiedById: Record<string, boolean>;
  slotTaken: boolean;
  equipmentDropdownOpen: boolean;
  startHebrewYear: number;
  startHebrewMonth: number;
  startHebrewDay: number;
  endHebrewYear: number;
  endHebrewMonth: number;
  endHebrewDay: number;
}

export interface SoundOrderDraftPayload {
  formValue: Record<string, unknown>;
  bookingUi: SoundOrderBookingUiSnapshot[];
  editingId: number | null;
  orderCancelled: boolean;
  phone1Digits: string;
  returnUrl: string | null;
  boardDate: string | null;
}

export interface WorkspaceLendingDraftPayload {
  formsJson: string;
  timeLimitEnabled: boolean;
  timeLimitValue: number;
}

export interface OrderDraftSnapshot {
  kind: OrderDraftKind;
  minimized: boolean;
  /** Customer / client name for the floating bar subtitle. */
  customerLabel: string;
  /** Absolute in-app path to reopen the form (e.g. `/orders/new`, `/tools/lending`). */
  resumePath: string;
  payload: SoundOrderDraftPayload | WorkspaceLendingDraftPayload;
  updatedAt: number;
}

/**
 * Holds an in-progress order/loan form while the user checks the calendar (PiP / minimize).
 * Survives route destroys via providedIn-root; cleared on successful save or explicit discard.
 */
@Injectable({ providedIn: 'root' })
export class OrderDraftService {
  private readonly draftSig = signal<OrderDraftSnapshot | null>(null);
  private readonly pendingResumeSig = signal(false);
  private readonly resumeTickSig = signal(0);

  readonly draft = this.draftSig.asReadonly();
  readonly resumeTick = this.resumeTickSig.asReadonly();

  /** Floating bar visibility — only while a draft is minimized. */
  readonly showBar = computed(() => {
    const d = this.draftSig();
    return d !== null && d.minimized === true;
  });

  readonly barLabel = computed(() => {
    const d = this.draftSig();
    if (!d) {
      return '';
    }
    return d.kind === 'sound-order'
      ? 'הזמנה בתהליך - לחץ להמשך'
      : 'השאלה בתהליך - לחץ להמשך';
  });

  readonly barDetail = computed(() => {
    const label = this.draftSig()?.customerLabel?.trim() ?? '';
    return label.length > 0 ? label : null;
  });

  minimize(
    input: Omit<OrderDraftSnapshot, 'minimized' | 'updatedAt'> & { minimized?: boolean }
  ): void {
    this.pendingResumeSig.set(false);
    this.draftSig.set({
      kind: input.kind,
      customerLabel: input.customerLabel?.trim() ?? '',
      resumePath: input.resumePath,
      payload: input.payload,
      minimized: true,
      updatedAt: Date.now()
    });
  }

  /**
   * Marks the draft for restore and bumps `resumeTick` so already-mounted
   * lending pages can react without a full remount.
   */
  beginResume(): OrderDraftSnapshot | null {
    const d = this.draftSig();
    if (!d || !d.minimized) {
      return null;
    }
    this.pendingResumeSig.set(true);
    this.resumeTickSig.update((n) => n + 1);
    return d;
  }

  /**
   * Called by the form after navigation / tick. Returns the payload once,
   * then clears the draft.
   */
  takePendingRestore<T extends SoundOrderDraftPayload | WorkspaceLendingDraftPayload>(
    kind: OrderDraftKind
  ): T | null {
    const d = this.draftSig();
    if (!d || d.kind !== kind || !this.pendingResumeSig()) {
      return null;
    }
    const payload = d.payload as T;
    this.clear();
    return payload;
  }

  /** True when a resume was requested and the draft still matches `kind`. */
  isPendingRestore(kind: OrderDraftKind): boolean {
    const d = this.draftSig();
    return d !== null && d.kind === kind && this.pendingResumeSig();
  }

  clear(): void {
    this.pendingResumeSig.set(false);
    this.draftSig.set(null);
  }

  /** Clear only if the active draft matches `kind` (e.g. after a successful save). */
  clearIfKind(kind: OrderDraftKind): void {
    if (this.draftSig()?.kind === kind) {
      this.clear();
    }
  }
}
