import { inject, Injectable, signal } from '@angular/core';
import { finalize, map, Observable, of, shareReplay, tap } from 'rxjs';

import { CustomerDto, CustomerSuggestDto, CustomerUpsertDto } from '../models/customer.model';
import { SystemType } from '../models/enums';
import { DataService } from './data.service';
import { SystemContextService } from './system-context.service';

@Injectable({ providedIn: 'root' })
export class CustomersStore {
  private readonly data = inject(DataService);
  private readonly systemContext = inject(SystemContextService);

  /** System-scoped customer profiles currently in memory (includes notes). */
  private readonly customersSignal = signal<CustomerDto[]>([]);
  readonly customers = this.customersSignal.asReadonly();

  private loaded = false;
  private loadedForSystem: SystemType | null = null;
  private loadInFlight: Observable<CustomerDto[]> | null = null;

  /**
   * System-scoped search for the customers admin list.
   * Loads the active system's linked customers once, then filters in memory.
   */
  search(q?: string): Observable<CustomerDto[]> {
    const trimmed = (q ?? '').trim();
    return this.ensureLoaded().pipe(map(() => this.filterCustomers(trimmed)));
  }

  /** Load (or reuse) the current system's customer list, including notes. */
  load(): Observable<CustomerDto[]> {
    return this.ensureLoaded();
  }

  /**
   * Full-profile global search (includes Notes). Prefer {@link searchSuggest} for typeahead.
   */
  searchGlobal(q?: string): Observable<CustomerDto[]> {
    return this.data.searchCustomers(q, { global: true });
  }

  /**
   * Lean cross-context autocomplete (max 10, no Notes/systems).
   */
  searchSuggest(q?: string): Observable<CustomerSuggestDto[]> {
    return this.data.searchCustomerSuggest(q);
  }

  /**
   * Profile notes for a loan/order phone (matches phone1 or phone2 digits).
   * Reads {@link customers} so OnPush views stay reactive after load/upsert.
   */
  notesForPhone(phone: string | null | undefined): string | null {
    const digits = CustomersStore.digitsOnly(phone);
    if (!digits) {
      return null;
    }

    const match = this.customersSignal().find((c) => {
      const phone1 = CustomersStore.digitsOnly(c.phone1);
      const phone2 = CustomersStore.digitsOnly(c.phone2);
      return phone1 === digits || (!!phone2 && phone2 === digits);
    });

    const notes = match?.notes?.trim();
    return notes ? notes : null;
  }

  upsert(saved: CustomerDto): void {
    const idx = this.customersSignal().findIndex((c) => c.phone1 === saved.phone1);
    const current = this.systemContext.currentSystemType();
    const linkedToCurrent =
      !saved.systemTypes?.length || saved.systemTypes.includes(current);

    if (!linkedToCurrent) {
      // Profile exists globally but not yet for this system — keep list scoped.
      return;
    }

    if (idx >= 0) {
      const next = [...this.customersSignal()];
      next[idx] = saved;
      this.customersSignal.set(next);
    } else {
      this.customersSignal.set([saved, ...this.customersSignal()]);
    }
    this.loaded = true;
  }

  upsertFromPayload(payload: CustomerUpsertDto): void {
    if (!this.loaded) {
      return;
    }
    const phone1 = payload.phone1.trim();
    const existing = this.customersSignal().find((c) => c.phone1 === phone1);
    const systemType = payload.systemType ?? this.systemContext.currentSystemType();
    const systemTypes = Array.from(
      new Set([...(existing?.systemTypes ?? []), systemType])
    );
    this.upsert({
      phone1,
      phone2: payload.phone2 ?? null,
      fullName: payload.fullName ?? null,
      address: payload.address ?? null,
      notes: payload.notes ?? existing?.notes ?? null,
      updatedAt: existing?.updatedAt ?? new Date().toISOString(),
      systemTypes
    });
  }

  remove(phone1: string): void {
    this.customersSignal.set(this.customersSignal().filter((c) => c.phone1 !== phone1));
  }

  replacePhone1(oldPhone1: string, saved: CustomerDto): void {
    this.customersSignal.set(this.customersSignal().filter((c) => c.phone1 !== oldPhone1));
    this.upsert(saved);
  }

  invalidate(): void {
    this.loaded = false;
    this.loadedForSystem = null;
    this.customersSignal.set([]);
    this.loadInFlight = null;
  }

  private ensureLoaded(): Observable<CustomerDto[]> {
    const system = this.systemContext.currentSystemType();
    if (this.loaded && this.loadedForSystem === system) {
      return of(this.customersSignal());
    }
    if (this.loadInFlight && this.loadedForSystem === system) {
      return this.loadInFlight;
    }

    if (this.loadedForSystem !== system) {
      this.loaded = false;
      this.customersSignal.set([]);
      this.loadInFlight = null;
    }

    this.loadedForSystem = system;
    this.loadInFlight = this.data.searchCustomers(undefined, { systemType: system }).pipe(
      tap((list) => {
        this.customersSignal.set(list ?? []);
        this.loaded = true;
        this.loadedForSystem = system;
      }),
      finalize(() => {
        this.loadInFlight = null;
      }),
      shareReplay(1)
    );
    return this.loadInFlight;
  }

  private filterCustomers(q: string): CustomerDto[] {
    const cache = this.customersSignal();
    if (q.length === 0) {
      return [...cache];
    }

    if (CustomersStore.isDigitsOnlyQuery(q)) {
      const digits = q.replace(/\D/g, '');
      if (digits.length < 2) {
        return [];
      }
      return cache.filter(
        (c) => c.phone1.startsWith(digits) || (!!c.phone2 && c.phone2.startsWith(digits))
      );
    }

    return cache.filter((c) => (c.fullName ?? '').includes(q));
  }

  private static digitsOnly(value: string | null | undefined): string {
    return (value ?? '').replace(/\D/g, '');
  }

  private static isDigitsOnlyQuery(q: string): boolean {
    let hasDigit = false;
    for (const ch of q) {
      if (/\d/.test(ch)) {
        hasDigit = true;
        continue;
      }
      if (ch === ' ' || ch === '-' || ch === '(' || ch === ')' || ch === '+') {
        continue;
      }
      return false;
    }
    return hasDigit;
  }
}
