import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

import { OrderDto } from '../models/order.model';
import { UnreturnedItemDto } from '../models/equipment-return.model';

/** Broadcasts order / unreturned mutations so list views stay in sync. */
@Injectable({ providedIn: 'root' })
export class OrdersSyncService {
  private readonly changedSubject = new Subject<OrderDto>();
  private readonly unreturnedChangedSubject = new Subject<UnreturnedItemDto | null>();

  /** Emits whenever an order was created, updated, or had a return recorded. */
  readonly orderChanged$ = this.changedSubject.asObservable();

  /**
   * Emits when a manual unreturned item is created or resolved.
   * Payload is the created row, or null when an item was resolved / list needs a full refresh.
   */
  readonly unreturnedChanged$ = this.unreturnedChangedSubject.asObservable();

  notifyOrderUpdated(order: OrderDto): void {
    this.changedSubject.next(order);
  }

  notifyUnreturnedChanged(item: UnreturnedItemDto | null = null): void {
    this.unreturnedChangedSubject.next(item);
  }
}
