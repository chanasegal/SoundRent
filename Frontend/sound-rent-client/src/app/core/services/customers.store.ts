import { inject, Injectable } from '@angular/core';
import { finalize, map, Observable, of, shareReplay, tap } from 'rxjs';

import { CustomerDto, CustomerUpsertDto } from '../models/customer.model';
import { DataService } from './data.service';

@Injectable({ providedIn: 'root' })
export class CustomersStore {
  private readonly data = inject(DataService);

  private cache: CustomerDto[] = [];
  private loaded = false;
  private loadInFlight: Observable<CustomerDto[]> | null = null;

  /** Load the capped customer list once, then serve searches from memory. */
  search(q?: string): Observable<CustomerDto[]> {
    const trimmed = (q ?? '').trim();
    return this.ensureLoaded().pipe(map(() => this.filterCustomers(trimmed)));
  }

  upsert(saved: CustomerDto): void {
    const idx = this.cache.findIndex((c) => c.phone1 === saved.phone1);
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
    this.upsert({
      phone1,
      phone2: payload.phone2 ?? null,
      fullName: payload.fullName ?? null,
      address: payload.address ?? null,
      notes: payload.notes ?? null,
      updatedAt: existing?.updatedAt ?? new Date().toISOString()
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
    this.cache = [];
    this.loadInFlight = null;
  }

  private ensureLoaded(): Observable<CustomerDto[]> {
    if (this.loaded) {
      return of(this.cache);
    }
    if (this.loadInFlight) {
      return this.loadInFlight;
    }

    this.loadInFlight = this.data.searchCustomers().pipe(
      tap((list) => {
        this.cache = list ?? [];
        this.loaded = true;
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

    const digits = q.replace(/\D/g, '');
    return this.cache.filter((c) => {
      if (digits.length >= 2) {
        if (c.phone1.includes(digits)) {
          return true;
        }
        if (c.phone2?.includes(digits)) {
          return true;
        }
      }
      const name = c.fullName ?? '';
      return name.includes(q);
    });
  }
}
