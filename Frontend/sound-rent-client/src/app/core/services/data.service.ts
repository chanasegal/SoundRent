import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, map, of } from 'rxjs';

import { environment } from '../../../environments/environment';
import { getApiErrorMessage } from '../utils/http-api-error';
import { TimeSlot } from '../models/enums';
import { OrderCreateUpdateDto, OrderDto } from '../models/order.model';
import { EquipmentDefinitionCreateDto, EquipmentDefinitionDto, EquipmentDefinitionUpdateDto, EquipmentDefinitionAvailabilityDto } from '../models/equipment-definition.model';
import { OrderShiftDto } from '../models/order.model';
import { WaitlistEntryCreateDto, WaitlistEntryDto } from '../models/waitlist.model';
import { CustomerDto, CustomerUpsertDto } from '../models/customer.model';
import { GeneralMemoDto, GeneralMemoUpdateDto } from '../models/general-memo.model';
import {
  LostEquipmentCreateDto,
  LostEquipmentDto,
  LostEquipmentUpdateDto
} from '../models/lost-equipment.model';
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
  private readonly reportsBase = `${environment.apiBaseUrl}/reports`;
  private readonly waitlistBase = `${environment.apiBaseUrl}/waitlist`;
  private readonly equipmentDefinitionsBase = `${environment.apiBaseUrl}/equipmentdefinitions`;
  private readonly customersBase = `${environment.apiBaseUrl}/customers`;
  private readonly memoBase = `${environment.apiBaseUrl}/memo`;
  private readonly lostEquipmentBase = `${environment.apiBaseUrl}/lost-equipment`;

  private notifyHttpError(error: unknown): void {
    this.toast.error(getApiErrorMessage(error));
  }

  getWeeklyOrders(startDate: string, endDate: string): Observable<OrderDto[]> {
    const params = new HttpParams().set('startDate', startDate).set('endDate', endDate);
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

  getWeeklyWaitlist(startDate: string, endDate: string): Observable<WaitlistEntryDto[]> {
    const params = new HttpParams().set('startDate', startDate).set('endDate', endDate);
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

  cancelOrder(id: number): Observable<OrderDto | null> {
    return this.http.post<OrderDto>(`${this.ordersBase}/${id}/cancel`, {}).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  markOrderAsPaid(id: number): Observable<OrderDto | null> {
    return this.http.post<OrderDto>(`${this.ordersBase}/${id}/mark-as-paid`, {}).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  getCancelledOrdersReport(): Observable<OrderDto[]> {
    return this.http.get<OrderDto[]>(`${this.reportsBase}/cancelled-orders`).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  getUnpaidOrdersReport(): Observable<OrderDto[]> {
    return this.http.get<OrderDto[]>(`${this.reportsBase}/unpaid-orders`).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
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

  /**
   * Bulk occupancy probe for the order-form equipment dropdown — one request
   * returns every equipment slot with an `isOccupied` flag for the given shifts.
   */
  getEquipmentAvailability(
    shifts: OrderShiftDto[],
    excludeOrderId?: number
  ): Observable<EquipmentDefinitionAvailabilityDto[]> {
    const body: { shifts: OrderShiftDto[]; excludeOrderId?: number } = { shifts };
    if (excludeOrderId != null) {
      body.excludeOrderId = excludeOrderId;
    }
    return this.http
      .post<EquipmentDefinitionAvailabilityDto[]>(`${this.equipmentDefinitionsBase}/availability`, body)
      .pipe(catchError(() => of([])));
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

  updateEquipmentDefinition(
    id: string,
    payload: EquipmentDefinitionUpdateDto
  ): Observable<EquipmentDefinitionDto | null> {
    const enc = encodeURIComponent(id);
    return this.http.put<EquipmentDefinitionDto>(`${this.equipmentDefinitionsBase}/${enc}`, payload).pipe(
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

  updateCustomer(originalPhone1: string, payload: CustomerUpsertDto): Observable<CustomerDto> {
    const enc = encodeURIComponent(originalPhone1);
    return this.http.put<CustomerDto>(`${this.customersBase}/${enc}`, payload);
  }

  deleteCustomer(phone1Digits: string): Observable<boolean> {
    const enc = encodeURIComponent(phone1Digits);
    return this.http.delete<void>(`${this.customersBase}/${enc}`).pipe(
      map(() => true),
      catchError((err) => {
        this.notifyHttpError(err);
        return of(false);
      })
    );
  }

  exportCustomersExcel(): Observable<HttpResponse<Blob> | null> {
    return this.http
      .get(`${this.customersBase}/export`, { observe: 'response', responseType: 'blob' })
      .pipe(
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

  getGeneralMemo(): Observable<GeneralMemoDto | null> {
    return this.http.get<GeneralMemoDto>(this.memoBase).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  saveGeneralMemo(payload: GeneralMemoUpdateDto): Observable<GeneralMemoDto | null> {
    return this.http.post<GeneralMemoDto>(this.memoBase, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  getLostEquipment(): Observable<LostEquipmentDto[]> {
    return this.http.get<LostEquipmentDto[]>(this.lostEquipmentBase).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  createLostEquipment(payload: LostEquipmentCreateDto): Observable<LostEquipmentDto | null> {
    return this.http.post<LostEquipmentDto>(this.lostEquipmentBase, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  updateLostEquipment(id: number, payload: LostEquipmentUpdateDto): Observable<LostEquipmentDto | null> {
    return this.http.put<LostEquipmentDto>(`${this.lostEquipmentBase}/${id}`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  deleteLostEquipment(id: number): Observable<boolean> {
    return this.http.delete<void>(`${this.lostEquipmentBase}/${id}`).pipe(
      map(() => true),
      catchError((err) => {
        this.notifyHttpError(err);
        return of(false);
      })
    );
  }
}
