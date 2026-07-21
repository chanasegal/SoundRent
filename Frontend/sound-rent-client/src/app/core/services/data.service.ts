import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, map, of, throwError } from 'rxjs';

import { environment } from '../../../environments/environment';
import { getApiErrorMessage } from '../utils/http-api-error';
import { SystemType, TimeSlot, LoanedEquipmentType } from '../models/enums';
import {
  ActiveOneTimeAccessoryLoanDto,
  OrderReturnRequestDto,
  MarkUnreturnedRequestDto,
  CreateManualUnreturnedItemDto,
  UnreturnedItemDto
} from '../models/equipment-return.model';
import { OrderCreateUpdateDto, OrderDto, InstitutionConflictDto, CreateManualCancelledOrderDto } from '../models/order.model';
import { EquipmentDefinitionBatchCreateDto, EquipmentDefinitionCreateDto, EquipmentDefinitionDto, EquipmentDefinitionUpdateDto, EquipmentDefinitionAvailabilityDto } from '../models/equipment-definition.model';
import { OrderShiftDto } from '../models/order.model';
import { WaitlistEntryCreateDto, WaitlistEntryDto } from '../models/waitlist.model';
import { CustomerDto, CustomerSuggestDto, CustomerUpsertDto } from '../models/customer.model';
import { InstitutionCreateUpdateDto, InstitutionDto } from '../models/institution.model';
import { GeneralMemoDto, GeneralMemoUpdateDto } from '../models/general-memo.model';
import {
  CreateOpenDebtDto,
  CreatedOpenDebtDto,
  MarkOpenDebtGroupPaidDto,
  OpenDebtGroupDto
} from '../models/open-debt.model';
import {
  LostEquipmentCreateDto,
  LostEquipmentDto,
  LostEquipmentUpdateDto
} from '../models/lost-equipment.model';
import {
  BlockedDateCreateDto,
  BlockedDateDto,
  BlockedDateUpdateDto
} from '../models/blocked-date.model';
import {
  AccessoryInventoryBatchUpdateDto,
  AccessoryInventoryGroupDto,
  AccessoryInventoryUpdateDto,
  AccessorySerialAvailabilityGroupDto,
  AccessorySerialAvailabilityRequestDto,
  AccessorySerialLocationDto
} from '../models/accessory-inventory.model';
import {
  CreateEquipmentDefaultAccessoriesBatchDto,
  CreateEquipmentDefaultAccessoryDto,
  EquipmentDefaultAccessoryCountDto,
  EquipmentDefaultAccessoryDto
} from '../models/equipment-default-accessory.model';
import {
  InventoryDefinitionBatchUpdateDto,
  InventoryDefinitionCreateDto,
  InventoryDefinitionEnsureDto,
  InventoryDefinitionDto,
  InventoryDefinitionSerialsUpdateDto,
  InventoryDefinitionUpdateDto
} from '../models/inventory-definition.model';
import {
  ToolAvailableSerialsGroupDto,
  ToolDefinitionBatchUpdateDto,
  ToolDefinitionCreateDto,
  ToolDefinitionDto,
  ToolDefinitionSerialsUpdateDto,
  ToolDefinitionUpdateDto,
  ToolItemBorrowHistoryDto,
  ToolLoanCreateDto,
  ToolLoanDto,
  ToolLoanReturnByCodeDto,
  ToolLoanReturnDto,
  ToolSerialLocationDto
} from '../models/tools-workspace.model';
import {
  BookAvailableCopiesGroupDto,
  BookBatchUpdateDto,
  BookCopiesUpdateDto,
  BookCreateDto,
  BookCopyLocationDto,
  BookDto,
  BookImportResultDto,
  BookItemBorrowHistoryDto,
  BookLoanCreateDto,
  BookLoanDto,
  BookLoanReturnByCodeDto,
  BookLoanReturnDto,
  BookUpdateDto
} from '../models/library-workspace.model';
import { ToastService } from './toast.service';
import { SystemContextService } from './system-context.service';

/** Response of `GET /api/orders/slot-taken` — purely informational. */
export interface SlotTakenResponse {
  taken: boolean;
}

@Injectable({ providedIn: 'root' })
export class DataService {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly systemContext = inject(SystemContextService);
  private readonly ordersBase = `${environment.apiBaseUrl}/orders`;
  private readonly reportsBase = `${environment.apiBaseUrl}/reports`;
  private readonly waitlistBase = `${environment.apiBaseUrl}/waitlist`;
  private readonly equipmentDefinitionsBase = `${environment.apiBaseUrl}/equipmentdefinitions`;
  private readonly customersBase = `${environment.apiBaseUrl}/customers`;
  private readonly institutionsBase = `${environment.apiBaseUrl}/institutions`;
  private readonly memoBase = `${environment.apiBaseUrl}/memo`;
  private readonly lostEquipmentBase = `${environment.apiBaseUrl}/lost-equipment`;
  private readonly blockedDatesBase = `${environment.apiBaseUrl}/blocked-dates`;
  private readonly accessoryInventoryBase = `${environment.apiBaseUrl}/accessoryinventory`;
  private readonly equipmentDefaultAccessoriesBase = `${environment.apiBaseUrl}/equipment-default-accessories`;
  private readonly inventoryDefinitionsBase = `${environment.apiBaseUrl}/inventory-definitions`;
  private readonly toolsInventoryBase = `${environment.apiBaseUrl}/tools-inventory`;
  private readonly toolsLoansBase = `${environment.apiBaseUrl}/tools-loans`;
  private readonly booksInventoryBase = `${environment.apiBaseUrl}/books-inventory`;
  private readonly bookLoansBase = `${environment.apiBaseUrl}/book-loans`;

  private activeSystemType(): SystemType {
    return this.systemContext.currentSystemType();
  }

  private withSystemType(params: HttpParams = new HttpParams()): HttpParams {
    return params.set('systemType', this.activeSystemType());
  }

  private notifyHttpError(error: unknown): void {
    this.toast.error(getApiErrorMessage(error));
  }

  getWeeklyOrders(startDate: string, endDate: string): Observable<OrderDto[]> {
    const params = this.withSystemType(
      new HttpParams().set('startDate', startDate).set('endDate', endDate)
    );
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
    const params = this.withSystemType(
      new HttpParams().set('startDate', startDate).set('endDate', endDate)
    );
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
    return this.http
      .post<WaitlistEntryDto>(this.waitlistBase, {
        ...payload,
        systemType: payload.systemType ?? this.activeSystemType()
      })
      .pipe(
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

  getQuickLoans(): Observable<OrderDto[]> {
    return this.http.get<OrderDto[]>(`${this.ordersBase}/quick-loans`).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  getActiveOneTimeAccessories(): Observable<ActiveOneTimeAccessoryLoanDto[]> {
    return this.http
      .get<ActiveOneTimeAccessoryLoanDto[]>(`${this.ordersBase}/active-one-time-accessories`)
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of([]);
        })
      );
  }

  createOrder(payload: OrderCreateUpdateDto): Observable<OrderDto | null> {
    return this.http
      .post<OrderDto>(this.ordersBase, {
        ...payload,
        systemType: payload.systemType ?? this.activeSystemType()
      })
      .pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  updateOrder(id: number, payload: OrderCreateUpdateDto): Observable<OrderDto | null> {
    return this.http
      .put<OrderDto>(`${this.ordersBase}/${id}`, {
        ...payload,
        systemType: payload.systemType ?? this.activeSystemType()
      })
      .pipe(
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

  updateUrgentBoardNote(id: number, urgentBoardNote: string | null): Observable<OrderDto | null> {
    return this.http
      .patch<OrderDto>(`${this.ordersBase}/${id}/urgent-board-note`, { urgentBoardNote })
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of(null);
        })
      );
  }

  recordOrderReturn(id: number, request: OrderReturnRequestDto): Observable<OrderDto | null> {
    return this.http.post<OrderDto>(`${this.ordersBase}/${id}/return`, request).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  markOrderUnreturned(id: number, request: MarkUnreturnedRequestDto): Observable<OrderDto | null> {
    return this.http.post<OrderDto>(`${this.ordersBase}/${id}/mark-unreturned`, request).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  getUnreturnedItems(): Observable<UnreturnedItemDto[]> {
    return this.http.get<UnreturnedItemDto[]>(`${this.ordersBase}/unreturned`).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  createManualUnreturnedItem(
    payload: CreateManualUnreturnedItemDto
  ): Observable<UnreturnedItemDto | null> {
    return this.http.post<UnreturnedItemDto>(`${this.ordersBase}/unreturned/manual`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  resolveManualUnreturnedItem(manualItemId: number): Observable<boolean> {
    return this.http
      .post<void>(`${this.ordersBase}/unreturned/manual/${manualItemId}/resolve`, {})
      .pipe(
        map(() => true),
        catchError((err) => {
          this.notifyHttpError(err);
          return of(false);
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

  createManualCancelledOrder(payload: CreateManualCancelledOrderDto): Observable<OrderDto | null> {
    return this.http.post<OrderDto>(`${this.reportsBase}/cancelled-orders`, {
      ...payload,
      systemType: payload.systemType ?? this.activeSystemType()
    }).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
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

  getOpenDebtGroupsReport(): Observable<OpenDebtGroupDto[]> {
    return this.http.get<OpenDebtGroupDto[]>(`${this.reportsBase}/open-debts`).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  createOpenDebt(payload: CreateOpenDebtDto): Observable<CreatedOpenDebtDto | null> {
    return this.http.post<CreatedOpenDebtDto>(`${this.reportsBase}/open-debts`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  markOpenDebtGroupPaid(payload: MarkOpenDebtGroupPaidDto): Observable<boolean> {
    return this.http.post<void>(`${this.reportsBase}/open-debts/mark-paid`, payload).pipe(
      map(() => true),
      catchError((err) => {
        this.notifyHttpError(err);
        return of(false);
      })
    );
  }

  markCustomerDebtPaid(debtId: number): Observable<boolean> {
    return this.http.post<void>(`${this.reportsBase}/open-debts/${debtId}/mark-paid`, {}).pipe(
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

  /**
   * Soft probe: another active order for the same institution on the same calendar day.
   */
  checkInstitutionConflict(
    institutionName: string | null | undefined,
    date: string,
    excludeOrderId?: number,
    institutionId?: number | null
  ): Observable<InstitutionConflictDto> {
    let params = new HttpParams().set('date', date);
    if (institutionId != null) {
      params = params.set('institutionId', String(institutionId));
    }
    if (institutionName != null && institutionName.trim().length > 0) {
      params = params.set('institutionName', institutionName.trim());
    }
    if (excludeOrderId != null) {
      params = params.set('excludeOrderId', String(excludeOrderId));
    }
    return this.http
      .get<InstitutionConflictDto>(`${this.ordersBase}/check-institution-conflict`, { params })
      .pipe(
        catchError(() =>
          of({
            hasConflict: false,
            conflictingOrderId: null,
            conflictingCustomerName: null,
            institutionNote: null,
            conflictDate: null
          } satisfies InstitutionConflictDto)
        )
      );
  }

  searchInstitutions(query?: string): Observable<InstitutionDto[]> {
    let params = this.withSystemType();
    if (query != null && query.trim().length > 0) {
      params = params.set('query', query.trim());
    }
    return this.http.get<InstitutionDto[]>(`${this.institutionsBase}/search`, { params }).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  createInstitution(payload: InstitutionCreateUpdateDto): Observable<InstitutionDto | null> {
    return this.http
      .post<InstitutionDto>(this.institutionsBase, {
        ...payload,
        systemType: payload.systemType ?? this.activeSystemType()
      })
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of(null);
        })
      );
  }

  updateInstitution(id: number, payload: InstitutionCreateUpdateDto): Observable<InstitutionDto | null> {
    return this.http
      .put<InstitutionDto>(`${this.institutionsBase}/${id}`, {
        ...payload,
        systemType: payload.systemType ?? this.activeSystemType()
      })
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of(null);
        })
      );
  }

  deleteInstitution(id: number): Observable<boolean> {
    return this.http.delete<void>(`${this.institutionsBase}/${id}`).pipe(
      map(() => true),
      catchError((err) => {
        this.notifyHttpError(err);
        return of(false);
      })
    );
  }

  exportInstitutionsExcel(): Observable<HttpResponse<Blob> | null> {
    return this.http
      .get(`${this.institutionsBase}/export-excel`, {
        params: this.withSystemType(),
        observe: 'response',
        responseType: 'blob'
      })
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of(null);
        })
      );
  }

  getInstitutionOrders(id: number): Observable<OrderDto[]> {
    return this.http.get<OrderDto[]>(`${this.institutionsBase}/${id}/orders`).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  getEquipmentDefinitions(): Observable<EquipmentDefinitionDto[]> {
    return this.http
      .get<EquipmentDefinitionDto[]>(this.equipmentDefinitionsBase, {
        params: this.withSystemType()
      })
      .pipe(
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
    const body: {
      shifts: OrderShiftDto[];
      excludeOrderId?: number;
      systemType: SystemType;
    } = { shifts, systemType: this.activeSystemType() };
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
    return this.http
      .post<EquipmentDefinitionDto>(this.equipmentDefinitionsBase, {
        ...payload,
        systemType: payload.systemType ?? this.activeSystemType()
      })
      .pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  /** Creates one definition per item code; does not modify existing rows or orders. */
  createEquipmentDefinitionsBatch(
    payload: EquipmentDefinitionBatchCreateDto
  ): Observable<EquipmentDefinitionDto[] | null> {
    return this.http
      .post<EquipmentDefinitionDto[]>(`${this.equipmentDefinitionsBase}/batch`, {
        ...payload,
        systemType: payload.systemType ?? this.activeSystemType()
      })
      .pipe(
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
  searchCustomers(
    q?: string,
    options?: { systemType?: SystemType; global?: boolean }
  ): Observable<CustomerDto[]> {
    let params = new HttpParams();
    if (q != null && q.trim().length > 0) {
      params = params.set('q', q.trim());
    }
    if (options?.global) {
      params = params.set('global', 'true');
    } else {
      params = params.set('systemType', options?.systemType ?? this.activeSystemType());
    }
    return this.http.get<CustomerDto[]>(`${this.customersBase}/search`, { params }).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  /**
   * Lean global autocomplete (suggest=true): max 10 rows, no Notes/systems.
   * Digits → phone prefix/exact; letters → FullName only.
   */
  searchCustomerSuggest(q?: string): Observable<CustomerSuggestDto[]> {
    const trimmed = (q ?? '').trim();
    if (trimmed.length < 2) {
      return of([]);
    }
    const params = new HttpParams()
      .set('q', trimmed)
      .set('global', 'true')
      .set('suggest', 'true');
    return this.http
      .get<CustomerSuggestDto[]>(`${this.customersBase}/search`, { params })
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of([]);
        })
      );
  }

  upsertCustomer(payload: CustomerUpsertDto): Observable<CustomerDto | null> {
    return this.http
      .post<CustomerDto>(this.customersBase, {
        ...payload,
        systemType: payload.systemType ?? this.activeSystemType()
      })
      .pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  updateCustomer(originalPhone1: string, payload: CustomerUpsertDto): Observable<CustomerDto> {
    const enc = encodeURIComponent(originalPhone1);
    return this.http.put<CustomerDto>(`${this.customersBase}/${enc}`, {
      ...payload,
      systemType: payload.systemType ?? this.activeSystemType()
    });
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
      .get(`${this.customersBase}/export`, {
        observe: 'response',
        responseType: 'blob',
        params: this.withSystemType()
      })
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

  getBlockedDates(startDate?: string, endDate?: string): Observable<BlockedDateDto[]> {
    let params = this.withSystemType();
    if (startDate) {
      params = params.set('startDate', startDate);
    }
    if (endDate) {
      params = params.set('endDate', endDate);
    }
    return this.http.get<BlockedDateDto[]>(this.blockedDatesBase, { params }).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  createBlockedDate(payload: BlockedDateCreateDto): Observable<BlockedDateDto | null> {
    return this.http
      .post<BlockedDateDto>(this.blockedDatesBase, {
        ...payload,
        systemType: payload.systemType ?? this.activeSystemType()
      })
      .pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  updateBlockedDate(id: number, payload: BlockedDateUpdateDto): Observable<BlockedDateDto | null> {
    return this.http.put<BlockedDateDto>(`${this.blockedDatesBase}/${id}`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  deleteBlockedDate(id: number): Observable<boolean> {
    return this.http.delete<void>(`${this.blockedDatesBase}/${id}`).pipe(
      map(() => true),
      catchError((err) => {
        this.notifyHttpError(err);
        return of(false);
      })
    );
  }

  getAccessoryInventory(): Observable<AccessoryInventoryGroupDto[]> {
    return this.http.get<AccessoryInventoryGroupDto[]>(this.accessoryInventoryBase).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  updateAccessoryInventory(
    equipmentType: LoanedEquipmentType,
    payload: AccessoryInventoryUpdateDto
  ): Observable<AccessoryInventoryGroupDto | null> {
    return this.http.put<AccessoryInventoryGroupDto>(`${this.accessoryInventoryBase}/${equipmentType}`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  updateAccessoryInventoryBatch(
    payload: AccessoryInventoryBatchUpdateDto
  ): Observable<AccessoryInventoryGroupDto[] | null> {
    return this.http.put<AccessoryInventoryGroupDto[]>(`${this.accessoryInventoryBase}/batch`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  getAccessorySerialAvailability(
    request: AccessorySerialAvailabilityRequestDto
  ): Observable<AccessorySerialAvailabilityGroupDto[]> {
    return this.http
      .post<AccessorySerialAvailabilityGroupDto[]>(`${this.accessoryInventoryBase}/availability`, request)
      .pipe(catchError(() => of([])));
  }

  getAccessorySerialLocation(
    equipmentType: LoanedEquipmentType,
    serialCode: string
  ): Observable<AccessorySerialLocationDto | null> {
    const params = new HttpParams()
      .set('equipmentType', equipmentType)
      .set('serialCode', serialCode.trim());
    return this.http.get<AccessorySerialLocationDto>(`${this.accessoryInventoryBase}/location`, { params }).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  getInventoryDefinitions(): Observable<InventoryDefinitionDto[]> {
    return this.http.get<InventoryDefinitionDto[]>(this.inventoryDefinitionsBase).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  /** Fresh catalog for admin modals — surfaces HTTP errors to the caller. */
  fetchInventoryDefinitionsCatalog(): Observable<InventoryDefinitionDto[]> {
    const params = new HttpParams().set('_', String(Date.now()));
    return this.http.get<InventoryDefinitionDto[]>(this.inventoryDefinitionsBase, { params }).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return throwError(() => err);
      })
    );
  }

  /** Assigned defaults for a mixer unit — surfaces HTTP errors (no silent empty list). */
  fetchEquipmentDefaultAccessories(
    parentEquipmentType: LoanedEquipmentType,
    parentSerialCode: string
  ): Observable<EquipmentDefaultAccessoryDto[]> {
    const params = new HttpParams()
      .set('parentEquipmentType', parentEquipmentType)
      .set('parentSerialCode', parentSerialCode.trim())
      .set('_', String(Date.now()));
    return this.http
      .get<EquipmentDefaultAccessoryDto[]>(this.equipmentDefaultAccessoriesBase, { params })
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return throwError(() => err);
        })
      );
  }

  createInventoryDefinition(
    payload: InventoryDefinitionCreateDto
  ): Observable<InventoryDefinitionDto | null> {
    return this.http.post<InventoryDefinitionDto>(this.inventoryDefinitionsBase, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  ensureInventoryDefinition(
    payload: InventoryDefinitionEnsureDto
  ): Observable<InventoryDefinitionDto | null> {
    return this.http
      .post<InventoryDefinitionDto>(`${this.inventoryDefinitionsBase}/ensure`, payload)
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of(null);
        })
      );
  }

  updateInventoryDefinition(
    id: number,
    payload: InventoryDefinitionUpdateDto
  ): Observable<InventoryDefinitionDto | null> {
    return this.http.put<InventoryDefinitionDto>(`${this.inventoryDefinitionsBase}/${id}`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  deleteInventoryDefinition(id: number): Observable<boolean> {
    return this.http.delete<void>(`${this.inventoryDefinitionsBase}/${id}`).pipe(
      map(() => true),
      catchError((err) => {
        this.notifyHttpError(err);
        return of(false);
      })
    );
  }

  updateInventoryDefinitionSerials(
    id: number,
    payload: InventoryDefinitionSerialsUpdateDto
  ): Observable<InventoryDefinitionDto | null> {
    return this.http
      .put<InventoryDefinitionDto>(`${this.inventoryDefinitionsBase}/${id}/serials`, payload)
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of(null);
        })
      );
  }

  updateInventoryDefinitionsBatch(
    payload: InventoryDefinitionBatchUpdateDto
  ): Observable<InventoryDefinitionDto[] | null> {
    return this.http.put<InventoryDefinitionDto[]>(`${this.inventoryDefinitionsBase}/batch`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  getEquipmentDefaultAccessories(
    parentEquipmentType: LoanedEquipmentType,
    parentSerialCode: string
  ): Observable<EquipmentDefaultAccessoryDto[]> {
    const params = new HttpParams()
      .set('parentEquipmentType', parentEquipmentType)
      .set('parentSerialCode', parentSerialCode.trim());
    return this.http
      .get<EquipmentDefaultAccessoryDto[]>(this.equipmentDefaultAccessoriesBase, { params })
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of([]);
        })
      );
  }

  getEquipmentDefaultAccessoryCounts(
    parentEquipmentType?: LoanedEquipmentType
  ): Observable<EquipmentDefaultAccessoryCountDto[]> {
    let params = new HttpParams();
    if (parentEquipmentType) {
      params = params.set('parentEquipmentType', parentEquipmentType);
    }
    return this.http
      .get<EquipmentDefaultAccessoryCountDto[]>(`${this.equipmentDefaultAccessoriesBase}/counts`, {
        params
      })
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of([]);
        })
      );
  }

  createEquipmentDefaultAccessory(
    payload: CreateEquipmentDefaultAccessoryDto
  ): Observable<EquipmentDefaultAccessoryDto | null> {
    return this.http
      .post<EquipmentDefaultAccessoryDto>(this.equipmentDefaultAccessoriesBase, payload)
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of(null);
        })
      );
  }

  createEquipmentDefaultAccessoriesBatch(
    payload: CreateEquipmentDefaultAccessoriesBatchDto
  ): Observable<EquipmentDefaultAccessoryDto[] | null> {
    return this.http
      .post<EquipmentDefaultAccessoryDto[]>(`${this.equipmentDefaultAccessoriesBase}/batch`, payload)
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of(null);
        })
      );
  }

  deleteEquipmentDefaultAccessory(id: number): Observable<boolean> {
    return this.http.delete<void>(`${this.equipmentDefaultAccessoriesBase}/${id}`).pipe(
      map(() => true),
      catchError((err) => {
        this.notifyHttpError(err);
        return of(false);
      })
    );
  }

  // --- Tools workspace (isolated from Sound inventory / orders) -------------

  getToolDefinitions(): Observable<ToolDefinitionDto[]> {
    return this.http.get<ToolDefinitionDto[]>(this.toolsInventoryBase).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  createToolDefinition(payload: ToolDefinitionCreateDto): Observable<ToolDefinitionDto | null> {
    return this.http.post<ToolDefinitionDto>(this.toolsInventoryBase, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  updateToolDefinition(
    id: number,
    payload: ToolDefinitionUpdateDto
  ): Observable<ToolDefinitionDto | null> {
    return this.http.put<ToolDefinitionDto>(`${this.toolsInventoryBase}/${id}`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  deleteToolDefinition(id: number): Observable<boolean> {
    return this.http.delete<void>(`${this.toolsInventoryBase}/${id}`).pipe(
      map(() => true),
      catchError((err) => {
        this.notifyHttpError(err);
        return of(false);
      })
    );
  }

  updateToolDefinitionSerials(
    id: number,
    payload: ToolDefinitionSerialsUpdateDto
  ): Observable<ToolDefinitionDto | null> {
    return this.http.put<ToolDefinitionDto>(`${this.toolsInventoryBase}/${id}/serials`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  updateToolDefinitionsBatch(
    payload: ToolDefinitionBatchUpdateDto
  ): Observable<ToolDefinitionDto[] | null> {
    return this.http.put<ToolDefinitionDto[]>(`${this.toolsInventoryBase}/batch`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  locateToolSerial(
    serialCode: string,
    toolDefinitionId?: number | null
  ): Observable<ToolSerialLocationDto | null> {
    let params = new HttpParams().set('serialCode', serialCode.trim());
    if (toolDefinitionId != null) {
      params = params.set('toolDefinitionId', String(toolDefinitionId));
    }
    return this.http.get<ToolSerialLocationDto>(`${this.toolsInventoryBase}/location`, { params }).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  getAvailableToolSerials(toolIds: number[]): Observable<string[]> {
    let params = new HttpParams();
    for (const id of toolIds) {
      params = params.append('toolIds', String(id));
    }
    return this.http.get<string[]>(`${this.toolsInventoryBase}/available-serials`, { params }).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  /** Single bulk fetch of all unborrowed serials, grouped by tool definition. */
  getAllAvailableToolSerials(): Observable<ToolAvailableSerialsGroupDto[]> {
    return this.http
      .get<ToolAvailableSerialsGroupDto[]>(`${this.toolsInventoryBase}/available-serials/all`)
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of([]);
        })
      );
  }

  getActiveToolLoans(): Observable<ToolLoanDto[]> {
    return this.http.get<ToolLoanDto[]>(`${this.toolsLoansBase}/active`).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  getToolLoans(returned?: boolean): Observable<ToolLoanDto[]> {
    let params = new HttpParams();
    if (returned !== undefined) {
      params = params.set('returned', String(returned));
    }
    return this.http.get<ToolLoanDto[]>(this.toolsLoansBase, { params }).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  createToolLoan(payload: ToolLoanCreateDto): Observable<ToolLoanDto | null> {
    return this.http.post<ToolLoanDto>(this.toolsLoansBase, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  returnToolLoan(id: number, payload: ToolLoanReturnDto): Observable<ToolLoanDto | null> {
    return this.http.post<ToolLoanDto>(`${this.toolsLoansBase}/${id}/return`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  returnToolLoanItem(
    loanId: number,
    itemId: number,
    payload: ToolLoanReturnDto
  ): Observable<ToolLoanDto | null> {
    return this.http
      .post<ToolLoanDto>(`${this.toolsLoansBase}/${loanId}/items/${itemId}/return`, payload)
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of(null);
        })
      );
  }

  /** Quick return by tool definition + serial code (one active item). */
  returnToolLoanByCode(payload: ToolLoanReturnByCodeDto): Observable<ToolLoanDto | null> {
    return this.http.post<ToolLoanDto>(`${this.toolsLoansBase}/return-by-code`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  undoToolLoanItemReturn(loanId: number, itemId: number): Observable<ToolLoanDto | null> {
    return this.http
      .post<ToolLoanDto>(`${this.toolsLoansBase}/${loanId}/items/${itemId}/undo-return`, {})
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of(null);
        })
      );
  }

  deleteToolLoan(loanId: number): Observable<boolean> {
    return this.http.delete<void>(`${this.toolsLoansBase}/${loanId}`).pipe(
      map(() => true),
      catchError((err) => {
        this.notifyHttpError(err);
        return of(false);
      })
    );
  }

  /** Completed returns for one tool+code, sorted ReturnedAt DESC on the server. */
  getToolItemBorrowHistory(
    toolDefinitionId: number,
    serialCode: string
  ): Observable<ToolItemBorrowHistoryDto[]> {
    const params = new HttpParams()
      .set('toolDefinitionId', String(toolDefinitionId))
      .set('serialCode', serialCode);
    return this.http
      .get<ToolItemBorrowHistoryDto[]>(`${this.toolsLoansBase}/item-history`, { params })
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of([]);
        })
      );
  }

  getToolLoansForCustomer(phone: string): Observable<ToolLoanDto[]> {
    const enc = encodeURIComponent((phone ?? '').trim());
    return this.http.get<ToolLoanDto[]>(`${this.toolsLoansBase}/customer/${enc}`).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  renewToolLoan(id: number): Observable<ToolLoanDto | null> {
    return this.http.post<ToolLoanDto>(`${this.toolsLoansBase}/${id}/renew`, {}).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  // --- Library workspace (books inventory / loans) ---------------------------

  getBooks(): Observable<BookDto[]> {
    return this.http.get<BookDto[]>(this.booksInventoryBase).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  createBook(payload: BookCreateDto): Observable<BookDto | null> {
    return this.http.post<BookDto>(this.booksInventoryBase, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  importBooksFromExcel(file: File): Observable<BookImportResultDto | null> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return this.http.post<BookImportResultDto>(`${this.booksInventoryBase}/import`, formData).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  updateBook(id: number, payload: BookUpdateDto): Observable<BookDto | null> {
    return this.http.put<BookDto>(`${this.booksInventoryBase}/${id}`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  deleteBook(id: number): Observable<boolean> {
    return this.http.delete<void>(`${this.booksInventoryBase}/${id}`).pipe(
      map(() => true),
      catchError((err) => {
        this.notifyHttpError(err);
        return of(false);
      })
    );
  }

  updateBookCopies(id: number, payload: BookCopiesUpdateDto): Observable<BookDto | null> {
    return this.http.put<BookDto>(`${this.booksInventoryBase}/${id}/copies`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  updateBooksBatch(payload: BookBatchUpdateDto): Observable<BookDto[] | null> {
    return this.http.put<BookDto[]>(`${this.booksInventoryBase}/batch`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  locateBookCopy(copyNumber: string, bookId?: number | null): Observable<BookCopyLocationDto | null> {
    let params = new HttpParams().set('copyNumber', copyNumber.trim());
    if (bookId != null) {
      params = params.set('bookId', String(bookId));
    }
    return this.http.get<BookCopyLocationDto>(`${this.booksInventoryBase}/location`, { params }).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  getAvailableBookCopies(bookIds: number[]): Observable<string[]> {
    let params = new HttpParams();
    for (const id of bookIds) {
      params = params.append('bookIds', String(id));
    }
    return this.http.get<string[]>(`${this.booksInventoryBase}/available-copies`, { params }).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  getAllAvailableBookCopies(): Observable<BookAvailableCopiesGroupDto[]> {
    return this.http
      .get<BookAvailableCopiesGroupDto[]>(`${this.booksInventoryBase}/available-copies/all`)
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of([]);
        })
      );
  }

  getActiveBookLoans(): Observable<BookLoanDto[]> {
    return this.http.get<BookLoanDto[]>(`${this.bookLoansBase}/active`).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  getBookLoans(returned?: boolean): Observable<BookLoanDto[]> {
    let params = new HttpParams();
    if (returned !== undefined) {
      params = params.set('returned', String(returned));
    }
    return this.http.get<BookLoanDto[]>(this.bookLoansBase, { params }).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  createBookLoan(payload: BookLoanCreateDto): Observable<BookLoanDto | null> {
    return this.http.post<BookLoanDto>(this.bookLoansBase, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  returnBookLoan(id: number, payload: BookLoanReturnDto): Observable<BookLoanDto | null> {
    return this.http.post<BookLoanDto>(`${this.bookLoansBase}/${id}/return`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  returnBookLoanItem(
    loanId: number,
    itemId: number,
    payload: BookLoanReturnDto
  ): Observable<BookLoanDto | null> {
    return this.http
      .post<BookLoanDto>(`${this.bookLoansBase}/${loanId}/items/${itemId}/return`, payload)
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of(null);
        })
      );
  }

  returnBookLoanByCode(payload: BookLoanReturnByCodeDto): Observable<BookLoanDto | null> {
    return this.http.post<BookLoanDto>(`${this.bookLoansBase}/return-by-code`, payload).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }

  undoBookLoanItemReturn(loanId: number, itemId: number): Observable<BookLoanDto | null> {
    return this.http
      .post<BookLoanDto>(`${this.bookLoansBase}/${loanId}/items/${itemId}/undo-return`, {})
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of(null);
        })
      );
  }

  deleteBookLoan(loanId: number): Observable<boolean> {
    return this.http.delete<void>(`${this.bookLoansBase}/${loanId}`).pipe(
      map(() => true),
      catchError((err) => {
        this.notifyHttpError(err);
        return of(false);
      })
    );
  }

  getBookItemBorrowHistory(bookId: number, copyNumber: string): Observable<BookItemBorrowHistoryDto[]> {
    const params = new HttpParams()
      .set('bookId', String(bookId))
      .set('copyNumber', copyNumber);
    return this.http
      .get<BookItemBorrowHistoryDto[]>(`${this.bookLoansBase}/item-history`, { params })
      .pipe(
        catchError((err) => {
          this.notifyHttpError(err);
          return of([]);
        })
      );
  }

  getBookLoansForCustomer(phone: string): Observable<BookLoanDto[]> {
    const enc = encodeURIComponent((phone ?? '').trim());
    return this.http.get<BookLoanDto[]>(`${this.bookLoansBase}/customer/${enc}`).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of([]);
      })
    );
  }

  renewBookLoan(id: number): Observable<BookLoanDto | null> {
    return this.http.post<BookLoanDto>(`${this.bookLoansBase}/${id}/renew`, {}).pipe(
      catchError((err) => {
        this.notifyHttpError(err);
        return of(null);
      })
    );
  }
}
