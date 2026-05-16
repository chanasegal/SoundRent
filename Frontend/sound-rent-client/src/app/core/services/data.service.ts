import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';

import { environment } from '../../../environments/environment';
import { getApiErrorMessage } from '../utils/http-api-error';
import { TimeSlot } from '../models/enums';
import { OrderCreateUpdateDto, OrderDto } from '../models/order.model';
import { EquipmentDefinitionCreateDto, EquipmentDefinitionDto } from '../models/equipment-definition.model';
import { WaitlistEntryCreateDto, WaitlistEntryDto } from '../models/waitlist.model';
import { CustomerDto, CustomerUpsertDto } from '../models/customer.model';
import { ToastService } from './toast.service';

/** Response of `GET /api/orders/slot-taken` — purely informational. */
export interface SlotTakenResponse {
  taken: boolean;
}

@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly ordersBase = `${environment.apiBaseUrl}/orders`;
  private readonly waitlistBase = `${environment.apiBaseUrl}/waitlist`;
  private readonly equipmentDefinitionsBase = `${environment.apiBaseUrl}/equipmentdefinitions`;
  private readonly customersBase = `${environment.apiBaseUrl}/customers`;

  private notifyHttpError(error: unknown): void {
    this.toast.error(getApiErrorMessage(error));
  }

  getWeeklyOrders(startDate: string): Observable<OrderDto[]> {
    const params = new HttpParams().set('startDate', startDate);
    return this.http.get<OrderDto[]>(`${this.ordersBase}/weekly`, { params }).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  /** Every order in the database (any date) — used for full Excel backup. */
  getOrdersExportAll(): Observable<OrderDto[]> {
    return this.http.get<OrderDto[]>(`${this.ordersBase}/export-all`).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  getWeeklyWaitlist(startDate: string): Observable<WaitlistEntryDto[]> {
    const params = new HttpParams().set('startDate', startDate);
    return this.http.get<WaitlistEntryDto[]>(`${this.waitlistBase}/weekly`, { params }).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  /** Every waitlist row in the database — used for full Excel backup (sorted on the server). */
  getWaitlistExportAll(): Observable<WaitlistEntryDto[]> {
    return this.http.get<WaitlistEntryDto[]>(`${this.waitlistBase}/export-all`).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  createWaitlistEntry(payload: WaitlistEntryCreateDto): Observable<WaitlistEntryDto | null> {
    return this.http.post<WaitlistEntryDto>(this.waitlistBase, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  /** `true` when the delete succeeded; `false` after a handled HTTP error (toast already shown). */
  deleteWaitlistEntry(id: number): Observable<boolean> {
    return this.http.delete<void>(`${this.waitlistBase}/${id}`).pipe(
      map(() => true),
      catchError((err) => {
        this.notifyHttpError(err);
        return of(false);
      })
    );
  }

  getOrderById(id: number): Observable<OrderDto | null> {
    return this.http.get<OrderDto>(`${this.ordersBase}/${id}`).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  createOrder(payload: OrderCreateUpdateDto): Observable<OrderDto | null> {
    return this.http.post<OrderDto>(this.ordersBase, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  updateOrder(id: number, payload: OrderCreateUpdateDto): Observable<OrderDto | null> {
    return this.http.put<OrderDto>(`${this.ordersBase}/${id}`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  /** `true` when the delete succeeded; `false` after a handled HTTP error (toast already shown). */
  deleteOrder(id: number): Observable<boolean> {
    return this.http.delete<void>(`${this.ordersBase}/${id}`).pipe(
      map(() => true),
      catchError((err) => {
        this.notifyHttpError(err);
        return of(false);
      })
    );
  }

  /**
   * Non-blocking duplicate-booking probe used by the order form. Returns
   * `{ taken: true }` when an order already exists for the given equipment /
   * date / time-slot combination, optionally excluding a specific order id
   * (so the order being edited never conflicts with itself).
   */
  checkSlotTaken(
    equipmentType: string,
    orderDate: string,
    timeSlot: TimeSlot,
    excludeOrderId?: number
  ): Observable<SlotTakenResponse> {
    let params = new HttpParams()
      .set('equipmentType', equipmentType)
      .set('orderDate', orderDate)
      .set('timeSlot', timeSlot);
    if (excludeOrderId != null) {
      params = params.set('excludeOrderId', String(excludeOrderId));
    }
    return this.http.get<SlotTakenResponse>(`${this.ordersBase}/slot-taken`, { params }).pipe(
      catchError(() => of({ taken: false }))
    );
  }

  getEquipmentDefinitions(): Observable<EquipmentDefinitionDto[]> {
    return this.http.get<EquipmentDefinitionDto[]>(this.equipmentDefinitionsBase).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  patchEquipmentDefinitionMaintenance(
    slotId: string,
    isMaintenanceMode: boolean
  ): Observable<EquipmentDefinitionDto | null> {
    const enc = encodeURIComponent(slotId);
    return this.http
      .patch<EquipmentDefinitionDto>(`${this.equipmentDefinitionsBase}/${enc}/maintenance`, {
        isMaintenanceMode
      })
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of(null);
        })
      );
  }

  createEquipmentDefinition(
    payload: EquipmentDefinitionCreateDto
  ): Observable<EquipmentDefinitionDto | null> {
    return this.http.post<EquipmentDefinitionDto>(this.equipmentDefinitionsBase, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  /**
   * Deletes a booking-slot definition. Errors are not swallowed here so callers
   * can handle validation payloads (e.g. future orders blocking delete).
   */
  deleteEquipmentDefinition(id: string): Observable<void> {
    const enc = encodeURIComponent(id);
    return this.http.delete<void>(`${this.equipmentDefinitionsBase}/${enc}`);
  }

  /** Search customers by digit substring in phones or by name; empty `q` returns a capped list. */
  searchCustomers(q?: string): Observable<CustomerDto[]> {
    let params = new HttpParams();
    if (q != null && q.trim().length > 0) {
      params = params.set('q', q.trim());
    }
    return this.http.get<CustomerDto[]>(`${this.customersBase}/search`, { params }).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  upsertCustomer(payload: CustomerUpsertDto): Observable<CustomerDto | null> {
    return this.http.post<CustomerDto>(this.customersBase, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  getCustomerOrders(phone1Digits: string): Observable<OrderDto[]> {
    const enc = encodeURIComponent(phone1Digits);
    return this.http.get<OrderDto[]>(`${this.customersBase}/${enc}/orders`).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }
}
