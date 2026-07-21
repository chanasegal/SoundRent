import { inject, Injectable } from '@angular/core';
import { finalize, map, Observable, of, shareReplay, tap } from 'rxjs';

import { CustomerDto, CustomerSuggestDto, CustomerUpsertDto } from '../models/customer.model';
import { SystemType } from '../models/enums';
import { DataService } from './data.service';
import { SystemContextService } from './system-context.service';

@Injectable({ providedIn: 'root' })
export class CustomersStore {
  private readonly data = inject(DataService);
  private readonly systemContext = inject(SystemContextService);

  private cache: CustomerDto[] = [];
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

  upsert(saved: CustomerDto): void {
    const idx = this.cache.findIndex((c) => c.phone1 === saved.phone1);
    const current = this.systemContext.currentSystemType();
    const linkedToCurrent =
      !saved.systemTypes?.length || saved.systemTypes.includes(current);

    if (!linkedToCurrent) {
      // Profile exists globally but not yet for this system — keep list scoped.
      return;
    }

    if (idx >= 0) {
      const next = [...this.cache];
      next[idx] = saved;
      this.cache = next;
    } else {
      this.cache = [saved, ...this.cache];
    }
    this.loaded = true;
  }

  upsertFromPayload(payload: CustomerUpsertDto): void {
    if (!this.loaded) {
      return;
    }
    const phone1 = payload.phone1.trim();
    const existing = this.cache.find((c) => c.phone1 === phone1);
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
    this.cache = this.cache.filter((c) => c.phone1 !== phone1);
  }

  replacePhone1(oldPhone1: string, saved: CustomerDto): void {
    this.cache = this.cache.filter((c) => c.phone1 !== oldPhone1);
    this.upsert(saved);
  }

  invalidate(): void {
    this.loaded = false;
    this.loadedForSystem = null;
    this.cache = [];
    this.loadInFlight = null;
  }

  private ensureLoaded(): Observable<CustomerDto[]> {
    const system = this.systemContext.currentSystemType();
    if (this.loaded && this.loadedForSystem === system) {
      return of(this.cache);
    }
    if (this.loadInFlight && this.loadedForSystem === system) {
      return this.loadInFlight;
    }

    if (this.loadedForSystem !== system) {
      this.loaded = false;
      this.cache = [];
      this.loadInFlight = null;
    }

    this.loadedForSystem = system;
    this.loadInFlight = this.data.searchCustomers(undefined, { systemType: system }).pipe(
      tap((list) => {
        this.cache = list ?? [];
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
    if (q.length === 0) {
      return [...this.cache];
    }

    if (CustomersStore.isDigitsOnlyQuery(q)) {
      const digits = q.replace(/\D/g, '');
      if (digits.length < 2) {
        return [];
      }
      return this.cache.filter(
        (c) => c.phone1.startsWith(digits) || (!!c.phone2 && c.phone2.startsWith(digits))
      );
    }

    return this.cache.filter((c) => (c.fullName ?? '').includes(q));
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
