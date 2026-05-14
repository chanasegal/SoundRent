import { inject, Injectable, signal } from '@angular/core';
import { Observable, map, tap } from 'rxjs';

import { LoanedEquipmentType } from '../models/enums';
import { LoanedEquipmentTypeNoteDefaultDto } from '../models/loaned-equipment-note-default.model';
import { DataService } from './data.service';

@Injectable({ providedIn: 'root' })
export class LoanedEquipmentNoteDefaultsStore {
  private readonly data = inject(DataService);

  readonly defaults = signal<LoanedEquipmentTypeNoteDefaultDto[]>([]);

  load(): Observable<void> {
    return this.data.getLoanedEquipmentNoteDefaults().pipe(
      tap((rows) => {
        this.defaults.set(rows ?? []);
      }),
      map(() => undefined)
    );
  }

  defaultCount(type: LoanedEquipmentType): number {
    const row = this.defaults().find((d) => d.loanedEquipmentType === type);
    const raw = row?.defaultNoteCount ?? 1;
    return Math.max(1, Math.min(20, raw));
  }
}
