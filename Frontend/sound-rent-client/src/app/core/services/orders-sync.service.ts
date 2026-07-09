import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

import { OrderDto } from '../models/order.model';

/** Broadcasts order mutations so list views (e.g. daily report) stay in sync. */
@Injectable({ providedIn: 'root' })
export class OrdersSyncService {
  private readonly changedSubject = new Subject<OrderDto>();

  /** Emits whenever an order was created, updated, or had a return recorded. */
  readonly orderChanged$ = this.changedSubject.asObservable();

  notifyOrderUpdated(order: OrderDto): void {
    this.changedSubject.next(order);
  }
}
