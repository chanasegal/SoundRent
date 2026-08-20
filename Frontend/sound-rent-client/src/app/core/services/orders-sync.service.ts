import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

import { OrderDto } from '../models/order.model';
import { UnreturnedItemDto } from '../models/equipment-return.model';

/**
 * Same-tab broadcast bus for operational data mutations.
 * Cross-device sync uses {@link startLiveDataRefresh} (API refetch), not this bus.
 */
@Injectable({ providedIn: 'root' })
export class OrdersSyncService {
  private readonly changedSubject = new Subject<OrderDto>();
  private readonly unreturnedChangedSubject = new Subject<UnreturnedItemDto | null>();
  private readonly debtChangedSubject = new Subject<void>();
  private readonly lostEquipmentChangedSubject = new Subject<void>();
  private readonly loanChangedSubject = new Subject<void>();

  /** Emits whenever an order was created, updated, or had a return recorded. */
  readonly orderChanged$ = this.changedSubject.asObservable();

  /**
   * Emits when a manual unreturned item is created or resolved.
   * Payload is the created row, or null when an item was resolved / list needs a full refresh.
   */
  readonly unreturnedChanged$ = this.unreturnedChangedSubject.asObservable();

  /** Emits when an open debt is created, marked paid, or otherwise cleared. */
  readonly debtChanged$ = this.debtChangedSubject.asObservable();

  /** Emits when forgotten/lost equipment is created, updated, or deleted. */
  readonly lostEquipmentChanged$ = this.lostEquipmentChangedSubject.asObservable();

  /** Emits when a tools/library loan item is returned or otherwise mutated. */
  readonly loanChanged$ = this.loanChangedSubject.asObservable();

  notifyOrderUpdated(order: OrderDto): void {
    this.changedSubject.next(order);
  }

  notifyUnreturnedChanged(item: UnreturnedItemDto | null = null): void {
    this.unreturnedChangedSubject.next(item);
  }

  notifyDebtChanged(): void {
    this.debtChangedSubject.next();
  }

  notifyLostEquipmentChanged(): void {
    this.lostEquipmentChangedSubject.next();
  }

  notifyLoanChanged(): void {
    this.loanChangedSubject.next();
  }
}
