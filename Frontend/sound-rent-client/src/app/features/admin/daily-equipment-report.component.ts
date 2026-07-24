import { CommonModule, DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { finalize } from 'rxjs';

import {
  AccessorySerialOptionDto
} from '../../core/models/accessory-inventory.model';
import { InventoryDefinitionDto } from '../../core/models/inventory-definition.model';
import {
  LOANED_EQUIPMENT_ORDER,
  LoanedEquipmentType
} from '../../core/models/enums';
import {
  LoanedEquipmentNoteDto,
  OrderCreateUpdateDto,
  OrderDto,
  OrderLoanedEquipmentDto,
  OrderShiftDto
} from '../../core/models/order.model';
import { DataService } from '../../core/services/data.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import { EquipmentDefinitionsStore } from '../../core/services/equipment-definitions.store';
import { InventoryDefinitionsStore } from '../../core/services/inventory-definitions.store';
import { ExportService } from '../../core/services/export.service';
import { HebrewDateParts, HebrewDateService } from '../../core/services/hebrew-date.service';
import { OrdersSyncService } from '../../core/services/orders-sync.service';
import { ToastService } from '../../core/services/toast.service';
import { HebrewCalendarPickerComponent } from '../../shared/hebrew-calendar-picker/hebrew-calendar-picker.component';

interface EquipmentLine {
  label: string;
  quantity: number;
  sortKey: number;
}

interface CustomerAccessoryLine {
  orderId: number;
  rowKey: string;
  label: string;
  quantity: number;
  sortKey: number;
  loanedEquipmentType: LoanedEquipmentType | null;
  inventoryDefinitionId: number | null;
  isCustomItem: boolean;
  serialCodes: string[];
  returnedSerialCodes: string[];
  hasRecordedReturns: boolean;
  shiftsOnDay: OrderShiftDto[];
}

interface CustomerBreakdown {
  customerName: string;
  phone: string;
  orderIds: number[];
  systemSlotIds: string[];
  accessoryRows: CustomerAccessoryLine[];
  hasLastNameDuplicate: boolean;
}

interface DailyEquipmentReport {
  selectedIso: string;
  summary: EquipmentLine[];
  customers: CustomerBreakdown[];
}

const SAME_DAY_NAME_DUPLICATE_TOOLTIP = 'שים לב! יש עוד הזמנה על שם זהה היום';

@Component({
  selector: 'app-daily-equipment-report',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, HebrewCalendarPickerComponent],
  templateUrl: './daily-equipment-report.component.html',
  styleUrl: './daily-equipment-report.component.scss'
})
export class DailyEquipmentReportComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly ordersSync = inject(OrdersSyncService);
  private readonly exportSvc = inject(ExportService);
  private readonly toast = inject(ToastService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly equipmentSlots = inject(EquipmentDefinitionsStore);
  private readonly inventoryStore = inject(InventoryDefinitionsStore);
  protected readonly pageTitle = inject(WorkspaceUiService).title('דוח ציוד');
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  private readonly initialHebrew = this.hebrew.toHebrewParts(new Date());
  private readonly extraYearsSig = signal<number[]>([]);

  protected readonly hebrewYearSig = signal(this.initialHebrew.year);
  protected readonly hebrewMonthSig = signal(this.initialHebrew.month);
  protected readonly hebrewDaySig = signal(this.initialHebrew.day);

  protected readonly orders = signal<OrderDto[]>([]);
  protected readonly loading = signal(false);
  protected readonly exportInProgress = signal(false);
  protected readonly sameDayNameDuplicateTooltip = SAME_DAY_NAME_DUPLICATE_TOOLTIP;

  private readonly accessoryAvailabilityByRow = signal<Map<string, AccessorySerialOptionDto[]>>(new Map());
  private readonly serialAvailabilityLoadingKeys = signal<Set<string>>(new Set());
  private readonly serialDraftByRowKey = signal<Map<string, string[]>>(new Map());
  protected readonly openSerialDropdownKey = signal<string | null>(null);
  protected readonly serialQuickEntry = signal('');
  protected readonly savingSerialRowKey = signal<string | null>(null);
  protected readonly openAddAccessoryCustomerKey = signal<string | null>(null);
  protected readonly addAccessoryTargetOrderId = signal<number | null>(null);
  protected readonly accessoryTypeQuery = signal('');
  private readonly pendingAccessoryRows = signal<CustomerAccessoryLine[]>([]);

  protected readonly dateForm = this.fb.group({
    hebrewYear: [this.initialHebrew.year, Validators.required],
    hebrewMonth: [this.initialHebrew.month, Validators.required],
    hebrewDay: [this.initialHebrew.day, Validators.required]
  });

  protected readonly yearOptions = computed(() => this.buildYearOptions());
  protected readonly monthOptions = computed(() => this.hebrew.monthsForYear(this.hebrewYearSig()));
  protected readonly dayOptions = computed(() => {
    const year = this.hebrewYearSig();
    const month = this.hebrewMonthSig();
    if (!year || !month) {
      return [];
    }
    const count = this.hebrew.daysInMonth(month, year);
    return Array.from({ length: count }, (_, i) => i + 1);
  });

  protected readonly selectedIso = computed(() => this.hebrewPartsToIso(this.hebrewYearSig(), this.hebrewMonthSig(), this.hebrewDaySig()));
  protected readonly selectedDateLabel = computed(() => {
    const iso = this.selectedIso();
    if (!iso) {
      return '';
    }
    const date = this.hebrew.parseIso(iso);
    return date ? this.hebrew.formatGregorianWithDayName(date) : iso;
  });
  protected readonly selectedHebrewLabel = computed(() => {
    const year = this.hebrewYearSig();
    const month = this.hebrewMonthSig();
    const day = this.hebrewDaySig();
    if (!year || !month || !day) {
      return '';
    }
    return this.hebrew.formatHebrewDate(day, month, year);
  });

  protected readonly report = computed((): DailyEquipmentReport | null => {
    const iso = this.selectedIso();
    if (!iso) {
      return null;
    }
    return this.buildReport(iso, this.orders());
  });

  ngOnInit(): void {
    this.equipmentSlots.load().subscribe();
    this.inventoryStore.load({ force: true }).subscribe();
    this.wireDateForm();
    this.loadOrders();
    this.ordersSync.orderChanged$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((order) => this.mergeOrderUpdate(order));
  }

  protected systemSlotLabel(slotId: string): string {
    return this.equipmentSlots.displayLabel(slotId);
  }

  protected dayLabel(day: number): string {
    return this.hebrew.dayGematriya(day);
  }

  protected yearLabel(year: number): string {
    return this.hebrew.yearGematriya(year);
  }

  protected patchHebrewFromCalendar(
    part: Partial<Pick<HebrewDateParts, 'year' | 'month' | 'day'>>
  ): void {
    const patch: Record<string, number> = {};
    if (part.year !== undefined) {
      patch['hebrewYear'] = part.year;
      this.ensureYearInOptions(part.year);
    }
    if (part.month !== undefined) {
      patch['hebrewMonth'] = part.month;
    }
    if (part.day !== undefined) {
      patch['hebrewDay'] = part.day;
    }
    if (Object.keys(patch).length > 0) {
      this.dateForm.patchValue(patch);
    }
  }

  protected refresh(): void {
    this.loadOrders();
  }

  protected formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone;
  }

  protected serialSummary(row: CustomerAccessoryLine): string {
    if (row.serialCodes.length === 0) {
      return '';
    }
    return row.serialCodes.join(', ');
  }

  protected isSerialReturned(row: CustomerAccessoryLine, code: string): boolean {
    return row.returnedSerialCodes.some(
      (c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
    );
  }

  protected isSerialEditLocked(row: CustomerAccessoryLine, code: string): boolean {
    return this.isSerialReturned(row, code);
  }

  protected rowHasRecordedReturns(row: CustomerAccessoryLine): boolean {
    return row.hasRecordedReturns;
  }

  protected allSerialsReturned(row: CustomerAccessoryLine): boolean {
    return row.serialCodes.length > 0 && row.returnedSerialCodes.length >= row.serialCodes.length;
  }

  protected canEditAccessorySerials(row: CustomerAccessoryLine): boolean {
    // Legacy free-text custom rows (no catalog id) stay read-only for serials.
    if (row.isCustomItem && row.inventoryDefinitionId == null && !this.isPendingAccessoryRow(row)) {
      return false;
    }
    if (!row.hasRecordedReturns) {
      return true;
    }
    return !this.allSerialsReturned(row);
  }

  protected customerKey(customer: CustomerBreakdown): string {
    return `${customer.customerName}|${customer.phone}`;
  }

  protected displayAccessoryRows(customer: CustomerBreakdown): CustomerAccessoryLine[] {
    const pending = this.pendingAccessoryRows().filter((row) => customer.orderIds.includes(row.orderId));
    return this.sortAccessoryRows([...customer.accessoryRows, ...pending]);
  }

  protected displayAccessoryQuantity(row: CustomerAccessoryLine): number {
    if (this.isSerialDropdownOpen(row)) {
      return this.getDraftCodes(row).length;
    }
    if (this.isPendingAccessoryRow(row)) {
      return row.serialCodes.length;
    }
    return row.quantity;
  }

  protected isPendingAccessoryRow(row: CustomerAccessoryLine): boolean {
    return row.rowKey.endsWith('|pending');
  }

  protected isAddAccessoryOpen(customer: CustomerBreakdown): boolean {
    return this.openAddAccessoryCustomerKey() === this.customerKey(customer);
  }

  protected addAccessoryOrderId(customer: CustomerBreakdown): number {
    if (customer.orderIds.length === 1) {
      return customer.orderIds[0]!;
    }
    return this.addAccessoryTargetOrderId() ?? customer.orderIds[0]!;
  }

  protected availableAccessoryDefsForOrder(orderId: number): InventoryDefinitionDto[] {
    const order = this.orders().find((o) => o.id === orderId);
    const usedTypes = new Set(
      (order?.loanedEquipments ?? [])
        .filter((le) => !le.isCustomItem && (le.quantity ?? 0) > 0 && le.loanedEquipmentType != null)
        .map((le) => le.loanedEquipmentType as LoanedEquipmentType)
    );
    const usedCustomNames = new Set(
      (order?.loanedEquipments ?? [])
        .filter((le) => le.isCustomItem && (le.quantity ?? 0) > 0)
        .map((le) => (le.customItemName ?? '').trim().toLowerCase())
        .filter((n) => n.length > 0)
    );
    const pending = this.pendingAccessoryRows().filter((row) => row.orderId === orderId);
    for (const row of pending) {
      if (row.loanedEquipmentType != null) {
        usedTypes.add(row.loanedEquipmentType);
      }
      if (row.isCustomItem) {
        usedCustomNames.add(row.label.trim().toLowerCase());
      }
    }

    return this.inventoryStore.definitions().filter((def) => {
      const linked = def.linkedEquipmentType as LoanedEquipmentType | null | undefined;
      if (linked && LOANED_EQUIPMENT_ORDER.includes(linked)) {
        return !usedTypes.has(linked);
      }
      return !usedCustomNames.has(def.displayName.trim().toLowerCase());
    });
  }

  protected filteredAccessoryDefsForOrder(orderId: number): InventoryDefinitionDto[] {
    const query = this.accessoryTypeQuery().trim().toLowerCase();
    const available = this.availableAccessoryDefsForOrder(orderId);
    if (!query) {
      return available;
    }
    return available.filter((d) => d.displayName.toLowerCase().includes(query));
  }

  protected toggleAddAccessory(customer: CustomerBreakdown): void {
    const key = this.customerKey(customer);
    if (this.openAddAccessoryCustomerKey() === key) {
      this.closeAddAccessory();
      return;
    }

    this.openAddAccessoryCustomerKey.set(key);
    this.addAccessoryTargetOrderId.set(customer.orderIds.length === 1 ? customer.orderIds[0]! : null);
    this.accessoryTypeQuery.set('');
    this.openSerialDropdownKey.set(null);
    queueMicrotask(() => {
      const input = this.document.querySelector<HTMLInputElement>('.add-accessory__search');
      input?.focus();
    });
  }

  protected onAddAccessoryOrderChange(customer: CustomerBreakdown, orderId: number): void {
    if (!customer.orderIds.includes(orderId)) {
      return;
    }
    this.addAccessoryTargetOrderId.set(orderId);
    this.accessoryTypeQuery.set('');
  }

  protected onAccessoryTypeChosen(customer: CustomerBreakdown, def: InventoryDefinitionDto): void {
    const orderId = this.addAccessoryOrderId(customer);
    const available = this.availableAccessoryDefsForOrder(orderId);
    if (!available.some((d) => d.id === def.id)) {
      return;
    }

    const pendingRow = this.buildPendingAccessoryRow(orderId, def);
    this.pendingAccessoryRows.update((rows) => [...rows, pendingRow]);
    this.initSerialDraft(pendingRow);
    this.openSerialDropdownKey.set(pendingRow.rowKey);
    this.loadSerialAvailability(pendingRow);
    this.closeAddAccessoryPicker();
  }

  protected toggleSerialDropdown(row: CustomerAccessoryLine): void {
    if (this.isSavingSerialRow(row)) {
      return;
    }

    if (!this.canEditAccessorySerials(row)) {
      this.toast.warning('כל הפריטים הוחזרו למלאי — לא ניתן לערוך');
      return;
    }

    const key = row.rowKey;
    if (this.openSerialDropdownKey() === key) {
      this.closeSerialDropdown(row, { saveIfChanged: true });
      return;
    }

    if (this.openSerialDropdownKey()) {
      const openKey = this.openSerialDropdownKey()!;
      const openRow = this.findAccessoryRowByKey(openKey);
      if (openRow) {
        this.closeSerialDropdown(openRow, { saveIfChanged: true });
      } else {
        this.openSerialDropdownKey.set(null);
      }
    }

    this.initSerialDraft(row);
    this.serialQuickEntry.set('');
    this.openSerialDropdownKey.set(key);
    this.loadSerialAvailability(row);
    queueMicrotask(() => this.focusSerialQuickEntry());
  }

  protected onSerialQuickEnter(row: CustomerAccessoryLine, event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const typed = this.serialQuickEntry().trim();
    if (!typed) {
      return;
    }

    const match = this.serialOptionsForRow(row).find(
      (opt) => opt.serialCode.localeCompare(typed, undefined, { sensitivity: 'accent' }) === 0
    );

    if (!match) {
      this.toast.warning(`קוד "${typed}" לא קיים במלאי לפריט זה`);
      return;
    }

    if (this.isSerialEditLocked(row, match.serialCode)) {
      this.toast.warning('פריט שהוחזר למלאי לא ניתן לביטול או שינוי');
      return;
    }

    const alreadySelected = this.isSerialSelected(row, match.serialCode);
    if (!alreadySelected && !match.isAvailable) {
      this.toast.warning(`קוד "${match.serialCode}" אינו זמין`);
      return;
    }

    this.toggleSerialSelection(row, match.serialCode, !alreadySelected);
    this.serialQuickEntry.set('');
    queueMicrotask(() => this.focusSerialQuickEntry());
  }

  private focusSerialQuickEntry(): void {
    const input = this.document.querySelector<HTMLInputElement>(
      '.accessory-serial-panel .multi-select__quick-input'
    );
    input?.focus();
    input?.select();
  }

  protected confirmSerialDropdown(row: CustomerAccessoryLine, event?: Event): void {
    event?.stopPropagation();
    this.closeSerialDropdown(row, { saveIfChanged: true });
  }

  protected cancelSerialDropdown(row: CustomerAccessoryLine, event?: Event): void {
    event?.stopPropagation();
    this.closeSerialDropdown(row, { saveIfChanged: false });
  }

  protected onSerialPanelClick(event: Event): void {
    event.stopPropagation();
  }

  protected isSerialDropdownOpen(row: CustomerAccessoryLine): boolean {
    return this.openSerialDropdownKey() === row.rowKey;
  }

  protected isSavingSerialRow(row: CustomerAccessoryLine): boolean {
    return this.savingSerialRowKey() === row.rowKey;
  }

  protected isSerialAvailabilityLoading(row: CustomerAccessoryLine): boolean {
    return this.serialAvailabilityLoadingKeys().has(row.rowKey);
  }

  protected serialPanelState(row: CustomerAccessoryLine): 'loading' | 'no-inventory' | 'all-booked' | 'options' {
    if (this.isSerialAvailabilityLoading(row)) {
      return 'loading';
    }

    const options = this.serialOptionsForRow(row);
    if (options.length === 0) {
      return 'no-inventory';
    }

    const hasSelectable = options.some(
      (opt) => opt.isAvailable || this.isSerialSelected(row, opt.serialCode)
    );
    if (!hasSelectable) {
      return 'all-booked';
    }

    return 'options';
  }

  protected serialPanelEmptyMessage(row: CustomerAccessoryLine): string {
    const state = this.serialPanelState(row);
    if (state === 'no-inventory') {
      return 'אין מלאי במערכת מפריט זה';
    }
    if (state === 'all-booked') {
      return 'כל הפריטים כרגע בחוץ (מושאלים)';
    }
    return '';
  }

  protected hasSerialDraftChanges(row: CustomerAccessoryLine): boolean {
    return !this.serialCodesEqual(this.getDraftCodes(row), this.getSavedCodes(row));
  }

  protected serialOptionsForRow(row: CustomerAccessoryLine): AccessorySerialOptionDto[] {
    return this.accessoryAvailabilityByRow().get(row.rowKey) ?? [];
  }

  protected isSerialSelected(row: CustomerAccessoryLine, code: string): boolean {
    return this.getDraftCodes(row).some(
      (c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
    );
  }

  protected toggleSerialSelection(row: CustomerAccessoryLine, code: string, checked: boolean): void {
    if (this.isSavingSerialRow(row) || !this.canEditAccessorySerials(row)) {
      return;
    }

    if (!checked && this.isSerialEditLocked(row, code)) {
      this.toast.warning('פריט שהוחזר למלאי לא ניתן לביטול או שינוי');
      return;
    }

    let next = [...this.getDraftCodes(row)];
    if (checked) {
      if (!next.some((c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0)) {
        next.push(code);
      }
    } else {
      next = next.filter((c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) !== 0);
    }

    this.setDraftCodes(row.rowKey, next);
  }

  protected exportToExcel(): void {
    const report = this.report();
    if (!report || (report.summary.length === 0 && report.customers.length === 0)) {
      this.toast.show('אין נתונים לייצוא לתאריך הנבחר', 'info');
      return;
    }
    if (this.exportInProgress()) {
      return;
    }

    this.exportInProgress.set(true);
    const iso = report.selectedIso;
    const summaryRows = report.summary.map((line) => ({
      פריט: line.label,
      כמות: line.quantity
    }));
    const breakdownRows: Record<string, unknown>[] = [];
    for (const customer of report.customers) {
      for (const item of customer.accessoryRows) {
        breakdownRows.push({
          לקוח: customer.customerName || '—',
          טלפון: customer.phone,
          'מספר הזמנה': item.orderId,
          'מערכת ראשית': customer.systemSlotIds.map((id) => this.systemSlotLabel(id)).join(', '),
          פריט: item.label,
          כמות: item.quantity,
          'קודי פריט': item.serialCodes.join(', '),
          'אזהרת שם משפחה': customer.hasLastNameDuplicate
            ? 'יש עוד הזמנה על שם משפחה זהה'
            : ''
        });
      }
      if (customer.accessoryRows.length === 0) {
        breakdownRows.push({
          לקוח: customer.customerName || '—',
          טלפון: customer.phone,
          'מספר הזמנה': customer.orderIds.join(', '),
          'מערכת ראשית': customer.systemSlotIds.map((id) => this.systemSlotLabel(id)).join(', '),
          פריט: '(ללא ציוד מושאל)',
          כמות: 0,
          'קודי פריט': '',
          'אזהרת שם משפחה': customer.hasLastNameDuplicate
            ? 'יש עוד הזמנה על שם משפחה זהה'
            : ''
        });
      }
    }

    void this.exportSvc
      .exportMultiSheetExcel(
        [
          { sheetName: 'סיכום יומי', rows: summaryRows },
          { sheetName: 'פירוט לפי לקוח', rows: breakdownRows }
        ],
        `equipment_report_${iso.replace(/-/g, '')}.xlsx`
      )
      .then(() => this.toast.success('קובץ Excel הורד'))
      .finally(() => this.exportInProgress.set(false));
  }

  private loadSerialAvailability(row: CustomerAccessoryLine): void {
    const iso = this.selectedIso();
    if (!iso) {
      return;
    }

    if (row.loanedEquipmentType == null) {
      const def =
        row.inventoryDefinitionId != null
          ? this.inventoryStore.byId(row.inventoryDefinitionId)
          : this.inventoryStore
              .definitions()
              .find(
                (d) =>
                  !d.linkedEquipmentType &&
                  d.displayName.localeCompare(row.label, 'he', { sensitivity: 'accent' }) === 0
              );
      const options = (() => {
        if (!def) {
          return [] as AccessorySerialOptionDto[];
        }
        const reserved = new Set(
          (row.serialCodes ?? [])
            .map((c) => c.trim())
            .filter((c) => c.length > 0)
            .map((c) => c.toLowerCase())
        );
        const units = def.serialUnits ?? [];
        if (units.length > 0) {
          return units.map((unit) => {
            const serialCode = unit.serialCode.trim();
            const status = unit.physicalStatus;
            const occupied = status === 'LoanedOut' || status === 'Missing';
            return {
              serialCode,
              isAvailable: !occupied || reserved.has(serialCode.toLowerCase())
            };
          });
        }
        return (def.serialCodes ?? []).map((serialCode) => ({
          serialCode,
          isAvailable: true
        }));
      })();
      this.accessoryAvailabilityByRow.update((map) => {
        const next = new Map(map);
        next.set(row.rowKey, options);
        return next;
      });
      return;
    }

    this.setSerialAvailabilityLoading(row.rowKey, true);
    this.data
      .getAccessorySerialAvailability({
        dates: [iso],
        shifts: row.shiftsOnDay,
        equipmentTypes: [row.loanedEquipmentType],
        excludeOrderId: row.orderId
      })
      .pipe(finalize(() => this.setSerialAvailabilityLoading(row.rowKey, false)))
      .subscribe((groups) => {
        const group = groups.find((g) => g.equipmentType === row.loanedEquipmentType);
        this.accessoryAvailabilityByRow.update((map) => {
          const next = new Map(map);
          next.set(row.rowKey, group?.options ?? []);
          return next;
        });
      });
  }

  private closeSerialDropdown(row: CustomerAccessoryLine, options: { saveIfChanged: boolean }): void {
    if (this.openSerialDropdownKey() !== row.rowKey) {
      return;
    }

    const draft = this.getDraftCodes(row);
    const saved = this.getSavedCodes(row);
    const hasChanges = !this.serialCodesEqual(draft, saved);

    if (options.saveIfChanged && hasChanges) {
      if (this.isPendingAccessoryRow(row) && draft.length === 0) {
        this.removePendingRow(row);
      } else {
        this.saveSerialCodes({ ...row, serialCodes: draft }, draft);
      }
    } else if (!options.saveIfChanged && this.isPendingAccessoryRow(row) && saved.length === 0) {
      this.removePendingRow(row);
    }

    this.clearSerialDraft(row.rowKey);
    this.serialQuickEntry.set('');
    this.openSerialDropdownKey.set(null);
  }

  private initSerialDraft(row: CustomerAccessoryLine): void {
    this.setDraftCodes(row.rowKey, [...this.getSavedCodes(row)]);
  }

  private getSavedCodes(row: CustomerAccessoryLine): string[] {
    if (this.isPendingAccessoryRow(row)) {
      return [...row.serialCodes];
    }

    const order = this.orders().find((o) => o.id === row.orderId);
    const line = (order?.loanedEquipments ?? []).find(
      (le) => !le.isCustomItem && le.loanedEquipmentType === row.loanedEquipmentType
    );
    if (!line) {
      return [...row.serialCodes];
    }

    return (line.notes ?? [])
      .slice()
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((n) => (n.content ?? '').trim())
      .filter((c) => c.length > 0);
  }

  private getDraftCodes(row: CustomerAccessoryLine): string[] {
    return this.serialDraftByRowKey().get(row.rowKey) ?? this.getSavedCodes(row);
  }

  private setDraftCodes(rowKey: string, codes: string[]): void {
    const unique: string[] = [];
    for (const code of codes) {
      if (!unique.some((c) => c.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0)) {
        unique.push(code);
      }
    }

    this.serialDraftByRowKey.update((map) => {
      const next = new Map(map);
      next.set(rowKey, unique);
      return next;
    });
  }

  private clearSerialDraft(rowKey: string): void {
    this.serialDraftByRowKey.update((map) => {
      if (!map.has(rowKey)) {
        return map;
      }
      const next = new Map(map);
      next.delete(rowKey);
      return next;
    });
  }

  private setSerialAvailabilityLoading(rowKey: string, loading: boolean): void {
    this.serialAvailabilityLoadingKeys.update((keys) => {
      const next = new Set(keys);
      if (loading) {
        next.add(rowKey);
      } else {
        next.delete(rowKey);
      }
      return next;
    });
  }

  private findAccessoryRowByKey(rowKey: string): CustomerAccessoryLine | null {
    for (const pending of this.pendingAccessoryRows()) {
      if (pending.rowKey === rowKey) {
        return pending;
      }
    }

    const iso = this.selectedIso();
    if (!iso) {
      return null;
    }

    for (const order of this.orders()) {
      for (const row of this.orderAccessoryLines(order, iso)) {
        if (row.rowKey === rowKey) {
          return row;
        }
      }
    }

    return null;
  }

  private serialCodesEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) {
      return false;
    }

    const normalize = (codes: string[]) =>
      [...codes]
        .map((c) => c.trim())
        .filter((c) => c.length > 0)
        .sort((x, y) => x.localeCompare(y, undefined, { sensitivity: 'accent' }));

    const left = normalize(a);
    const right = normalize(b);
    return left.every((code, index) => code.localeCompare(right[index] ?? '', undefined, { sensitivity: 'accent' }) === 0);
  }

  private saveSerialCodes(row: CustomerAccessoryLine, codes: string[]): void {
    const order = this.orders().find((o) => o.id === row.orderId);
    if (!order) {
      return;
    }

    if (this.isPendingAccessoryRow(row) && codes.length === 0) {
      return;
    }

    this.savingSerialRowKey.set(row.rowKey);

    const loanedEquipments = this.isPendingAccessoryRow(row)
      ? row.isCustomItem || row.loanedEquipmentType == null
        ? this.appendOrPatchCustomAccessory(order, row.label, codes)
        : this.appendOrPatchAccessory(order, row.loanedEquipmentType!, codes)
      : this.patchOrderLoanedSerials(order, row, codes);
    const payload = this.orderToUpdatePayload(order, loanedEquipments);
    const wasPending = this.isPendingAccessoryRow(row);

    this.data
      .updateOrder(row.orderId, payload)
      .pipe(finalize(() => this.savingSerialRowKey.set(null)))
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.orders.update((list) => list.map((o) => (o.id === updated.id ? updated : o)));
        this.ordersSync.notifyOrderUpdated(updated);
        if (wasPending) {
          this.removePendingRow(row);
        }
        this.clearSerialDraft(row.rowKey);
        this.inventoryStore.load({ force: true }).subscribe();
        this.toast.success(wasPending ? 'אביזר נוסף להזמנה' : 'קודי פריט עודכנו');
      });
  }

  private buildPendingAccessoryRow(orderId: number, def: InventoryDefinitionDto): CustomerAccessoryLine {
    const order = this.orders().find((o) => o.id === orderId);
    const iso = this.selectedIso() ?? '';
    const shiftsOnDay = (order?.shifts ?? []).filter((shift) => shift.orderDate === iso);
    const linked = def.linkedEquipmentType as LoanedEquipmentType | null | undefined;
    const type =
      linked && LOANED_EQUIPMENT_ORDER.includes(linked) ? linked : null;
    const typeIndex = type ? LOANED_EQUIPMENT_ORDER.indexOf(type) : -1;

    return {
      orderId,
      rowKey: type
        ? `${orderId}|${type}|pending`
        : `${orderId}|inv-${def.id}|pending`,
      label: def.displayName,
      quantity: 0,
      sortKey: type ? 1000 + (typeIndex >= 0 ? typeIndex : 99) : 2500,
      loanedEquipmentType: type,
      inventoryDefinitionId: def.id,
      isCustomItem: type == null,
      serialCodes: [],
      returnedSerialCodes: [],
      hasRecordedReturns: order?.isReturnProcessed === true,
      shiftsOnDay
    };
  }

  private appendOrPatchAccessory(
    order: OrderDto,
    type: LoanedEquipmentType,
    codes: string[]
  ): OrderLoanedEquipmentDto[] {
    const existing = order.loanedEquipments ?? [];
    const matchIndex = existing.findIndex((le) => !le.isCustomItem && le.loanedEquipmentType === type);
    const existingLine = matchIndex >= 0 ? existing[matchIndex] : undefined;
    const notes = this.buildAccessoryNotes(codes, existingLine?.notes);
    const nextLine: OrderLoanedEquipmentDto = {
      ...(matchIndex >= 0 && existing[matchIndex]?.id ? { id: existing[matchIndex].id } : {}),
      isCustomItem: false,
      loanedEquipmentType: type,
      quantity: codes.length,
      expectedNoteCount: codes.length,
      notes
    };

    if (matchIndex >= 0) {
      return existing.map((le, index) => (index === matchIndex ? { ...le, ...nextLine } : le));
    }

    return [...existing, nextLine];
  }

  private appendOrPatchCustomAccessory(
    order: OrderDto,
    label: string,
    codes: string[]
  ): OrderLoanedEquipmentDto[] {
    const existing = order.loanedEquipments ?? [];
    const name = label.trim();
    const matchIndex = existing.findIndex(
      (le) =>
        le.isCustomItem &&
        (le.customItemName ?? '').trim().localeCompare(name, 'he', { sensitivity: 'accent' }) === 0
    );
    const existingLine = matchIndex >= 0 ? existing[matchIndex] : undefined;
    const notes = this.buildAccessoryNotes(codes, existingLine?.notes);
    const quantity = codes.length > 0 ? codes.length : Math.max(existingLine?.quantity ?? 1, 1);
    const nextLine: OrderLoanedEquipmentDto = {
      ...(matchIndex >= 0 && existing[matchIndex]?.id ? { id: existing[matchIndex].id } : {}),
      isCustomItem: true,
      customItemName: name || 'פריט נוסף',
      loanedEquipmentType: null,
      quantity,
      expectedNoteCount: quantity,
      notes
    };

    if (matchIndex >= 0) {
      return existing.map((le, index) => (index === matchIndex ? { ...le, ...nextLine } : le));
    }

    return [...existing, nextLine];
  }

  private removePendingRow(row: CustomerAccessoryLine): void {
    this.pendingAccessoryRows.update((rows) => rows.filter((pending) => pending.rowKey !== row.rowKey));
    if (this.openSerialDropdownKey() === row.rowKey) {
      this.openSerialDropdownKey.set(null);
    }
  }

  private closeAddAccessory(): void {
    this.closeAddAccessoryPicker();
  }

  private closeAddAccessoryPicker(): void {
    this.openAddAccessoryCustomerKey.set(null);
    this.addAccessoryTargetOrderId.set(null);
    this.accessoryTypeQuery.set('');
  }

  private patchOrderLoanedSerials(
    order: OrderDto,
    row: CustomerAccessoryLine,
    codes: string[]
  ): OrderLoanedEquipmentDto[] {
    return (order.loanedEquipments ?? []).map((le) => {
      const isMatch = row.isCustomItem
        ? !!le.isCustomItem &&
          (le.customItemName ?? '').trim().localeCompare(row.label, 'he', { sensitivity: 'accent' }) === 0
        : !le.isCustomItem && le.loanedEquipmentType === row.loanedEquipmentType;
      if (!isMatch) {
        return le;
      }

      const notes = this.buildAccessoryNotes(codes, le.notes);
      return {
        ...le,
        quantity: codes.length > 0 ? codes.length : le.quantity,
        expectedNoteCount: codes.length > 0 ? codes.length : le.expectedNoteCount,
        notes
      };
    });
  }

  private buildAccessoryNotes(
    codes: string[],
    existingNotes?: LoanedEquipmentNoteDto[]
  ): LoanedEquipmentNoteDto[] {
    const returnedByCode = new Map<string, boolean>();
    for (const note of existingNotes ?? []) {
      const content = (note.content ?? '').trim();
      if (content.length > 0 && note.isReturned) {
        returnedByCode.set(content.toLowerCase(), true);
      }
    }

    return codes.map((content, ordinal) => ({
      ordinal,
      content,
      ...(returnedByCode.get(content.toLowerCase()) ? { isReturned: true } : {})
    }));
  }

  private orderToUpdatePayload(
    order: OrderDto,
    loanedEquipments: OrderLoanedEquipmentDto[]
  ): OrderCreateUpdateDto {
    return {
      equipmentDefinitionIds: order.equipmentDefinitionIds,
      shifts: order.shifts,
      customerName: order.customerName,
      phone: order.phone,
      phone2: order.phone2,
      address: order.address,
      depositType: order.depositType,
      depositOnName: order.depositOnName,
      paymentAmount: order.paymentAmount,
      isUnpaid: order.isUnpaid,
      returnTimeType: order.returnTimeType,
      customReturnTime: order.customReturnTime,
      notes: order.notes,
      loanedEquipments
    };
  }

  private wireDateForm(): void {
    const { hebrewYear, hebrewMonth, hebrewDay } = this.dateForm.controls;
    this.ensureYearInOptions(Number(hebrewYear.value));
    this.syncHebrewSignals(
      Number(hebrewYear.value),
      Number(hebrewMonth.value),
      Number(hebrewDay.value)
    );

    hebrewYear.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((year) => {
      this.syncHebrewSignals(Number(year), Number(hebrewMonth.value), Number(hebrewDay.value));
      this.ensureYearInOptions(Number(year));
      this.normalizeHebrewSelection();
      this.openSerialDropdownKey.set(null);
      this.closeAddAccessory();
      this.loadOrders();
    });

    hebrewMonth.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((month) => {
      this.syncHebrewSignals(Number(hebrewYear.value), Number(month), Number(hebrewDay.value));
      this.normalizeHebrewSelection();
      this.openSerialDropdownKey.set(null);
      this.closeAddAccessory();
      this.loadOrders();
    });

    hebrewDay.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((day) => {
      this.syncHebrewSignals(Number(hebrewYear.value), Number(hebrewMonth.value), Number(day));
      this.openSerialDropdownKey.set(null);
      this.closeAddAccessory();
      this.loadOrders();
    });
  }

  private syncHebrewSignals(year: number, month: number, day: number): void {
    this.hebrewYearSig.set(year);
    this.hebrewMonthSig.set(month);
    this.hebrewDaySig.set(day);
  }

  private normalizeHebrewSelection(): void {
    const year = Number(this.dateForm.controls.hebrewYear.value);
    let month = Number(this.dateForm.controls.hebrewMonth.value);
    let day = Number(this.dateForm.controls.hebrewDay.value);
    if (!year || !month || !day) {
      return;
    }

    if (!this.hebrew.isLeapYear(year) && month === 13) {
      month = 12;
      this.dateForm.controls.hebrewMonth.setValue(month, { emitEvent: false });
      this.hebrewMonthSig.set(month);
    }

    const maxDay = this.hebrew.daysInMonth(month, year);
    if (day > maxDay) {
      day = maxDay;
      this.dateForm.controls.hebrewDay.setValue(day, { emitEvent: false });
      this.hebrewDaySig.set(day);
    }
  }

  private mergeOrderUpdate(updated: OrderDto): void {
    const iso = this.selectedIso();
    if (!iso) {
      return;
    }

    const hasShiftOnDay = (updated.shifts ?? []).some((shift) => shift.orderDate === iso);
    const alreadyListed = this.orders().some((order) => order.id === updated.id);

    if (!hasShiftOnDay && !alreadyListed) {
      return;
    }

    this.orders.update((list) => {
      const index = list.findIndex((order) => order.id === updated.id);
      if (index >= 0) {
        if (!hasShiftOnDay) {
          return list.filter((order) => order.id !== updated.id);
        }
        const next = [...list];
        next[index] = updated;
        return next;
      }
      return hasShiftOnDay ? [...list, updated] : list;
    });

    this.accessoryAvailabilityByRow.update((map) => {
      const next = new Map(map);
      for (const key of next.keys()) {
        if (key.startsWith(`${updated.id}|`)) {
          next.delete(key);
        }
      }
      return next;
    });
    this.serialDraftByRowKey.set(new Map());
    this.openSerialDropdownKey.set(null);
  }

  private loadOrders(): void {
    const iso = this.hebrewPartsToIso(
      this.hebrewYearSig(),
      this.hebrewMonthSig(),
      this.hebrewDaySig()
    );
    if (!iso) {
      return;
    }

    this.loading.set(true);
    this.data
      .getWeeklyOrders(iso, iso)
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (list) => {
          this.orders.set(list ?? []);
          this.accessoryAvailabilityByRow.set(new Map());
          this.serialAvailabilityLoadingKeys.set(new Set());
          this.serialDraftByRowKey.set(new Map());
          this.pendingAccessoryRows.set([]);
          this.closeAddAccessory();
          this.openSerialDropdownKey.set(null);
        }
      });
  }

  private buildReport(iso: string, orders: OrderDto[]): DailyEquipmentReport {
    // Accessory-only loans (Quick Loan / cables-only) have no main equipment slots —
    // exclude them so the report only shows orders with at least one system booking.
    const ordersOnDay = orders.filter(
      (order) =>
        (order.shifts ?? []).some((shift) => shift.orderDate === iso) &&
        this.hasMainEquipment(order)
    );
    const duplicateOrderIds = this.buildSameDayLastNameDuplicateOrderIds(ordersOnDay, iso);

    const summaryMap = new Map<string, EquipmentLine>();
    const customerGroups = new Map<string, CustomerBreakdown>();

    for (const order of ordersOnDay) {
      const lines = this.orderLoanedAccessoryLines(order);
      for (const line of lines) {
        this.mergeEquipmentLine(summaryMap, line);
      }

      const customerKey = `${(order.customerName ?? '').trim()}|${order.phone}`;
      let group = customerGroups.get(customerKey);
      if (!group) {
        group = {
          customerName: (order.customerName ?? '').trim(),
          phone: order.phone,
          orderIds: [],
          systemSlotIds: [],
          accessoryRows: [],
          hasLastNameDuplicate: false
        };
        customerGroups.set(customerKey, group);
      }
      group.orderIds.push(order.id);
      this.mergeSystemSlotIds(group, order);
      if (duplicateOrderIds.has(order.id)) {
        group.hasLastNameDuplicate = true;
      }

      const accessoryRows = this.orderAccessoryLines(order, iso);
      group.accessoryRows.push(...accessoryRows);
      group.accessoryRows = this.sortAccessoryRows(group.accessoryRows);
    }

    for (const group of customerGroups.values()) {
      group.systemSlotIds = this.sortSystemSlotIds(group.systemSlotIds);
    }

    const customers = [...customerGroups.values()].sort((a, b) => {
      const nameCmp = a.customerName.localeCompare(b.customerName, 'he');
      if (nameCmp !== 0) {
        return nameCmp;
      }
      return a.phone.localeCompare(b.phone, 'he');
    });

    return {
      selectedIso: iso,
      summary: this.sortEquipmentLines(summaryMap),
      customers
    };
  }

  private orderAccessoryLines(order: OrderDto, iso: string): CustomerAccessoryLine[] {
    const shiftsOnDay = (order.shifts ?? []).filter((shift) => shift.orderDate === iso);
    const lines: CustomerAccessoryLine[] = [];

    for (const le of order.loanedEquipments ?? []) {
      const qty = le.quantity ?? 0;
      if (qty <= 0) {
        continue;
      }

      const label = le.isCustomItem
        ? (le.customItemName?.trim() || 'פריט נוסף')
        : le.loanedEquipmentType
          ? this.inventoryStore.displayLabelForType(le.loanedEquipmentType as LoanedEquipmentType)
          : String(le.loanedEquipmentType);
      const typeIndex = LOANED_EQUIPMENT_ORDER.indexOf(le.loanedEquipmentType as LoanedEquipmentType);
      const sortKey = le.isCustomItem ? 2500 : 1000 + (typeIndex >= 0 ? typeIndex : 99);
      const serialCodes = (le.notes ?? [])
        .slice()
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((n) => (n.content ?? '').trim())
        .filter((c) => c.length > 0);
      const returnedSerialCodes = (le.notes ?? [])
        .filter((n) => n.isReturned && (n.content ?? '').trim().length > 0)
        .map((n) => (n.content ?? '').trim());
      const loanedEquipmentType = le.isCustomItem
        ? null
        : (le.loanedEquipmentType as LoanedEquipmentType);
      const inventoryDefinitionId = le.isCustomItem
        ? this.inventoryStore
            .definitions()
            .find(
              (d) =>
                !d.linkedEquipmentType &&
                d.displayName.localeCompare(label, 'he', { sensitivity: 'accent' }) === 0
            )?.id ?? null
        : this.inventoryStore
            .definitions()
            .find((d) => d.linkedEquipmentType === loanedEquipmentType)?.id ?? null;
      const rowKey = le.isCustomItem
        ? `${order.id}|custom|${label}`
        : `${order.id}|${loanedEquipmentType}`;

      lines.push({
        orderId: order.id,
        rowKey,
        label,
        quantity: qty,
        sortKey,
        loanedEquipmentType,
        inventoryDefinitionId,
        isCustomItem: !!le.isCustomItem,
        serialCodes,
        returnedSerialCodes,
        hasRecordedReturns: order.isReturnProcessed === true,
        shiftsOnDay
      });
    }

    return this.sortAccessoryRows(lines);
  }

  /** Aggregates `loanedEquipments` quantity counters only (accessories), not booking slots. */
  private orderLoanedAccessoryLines(order: OrderDto): EquipmentLine[] {
    const map = new Map<string, EquipmentLine>();

    for (const le of order.loanedEquipments ?? []) {
      const qty = le.quantity ?? 0;
      if (qty <= 0) {
        continue;
      }
      const label = le.isCustomItem
        ? (le.customItemName?.trim() || 'פריט נוסף')
        : le.loanedEquipmentType
          ? this.inventoryStore.displayLabelForType(le.loanedEquipmentType as LoanedEquipmentType)
          : String(le.loanedEquipmentType);
      const typeIndex = LOANED_EQUIPMENT_ORDER.indexOf(le.loanedEquipmentType as LoanedEquipmentType);
      const sortKey = le.isCustomItem ? 2500 : 1000 + (typeIndex >= 0 ? typeIndex : 99);
      this.mergeEquipmentLine(map, { label, quantity: qty, sortKey });
    }

    return this.sortEquipmentLines(map);
  }

  /** True when the order has at least one main equipment booking slot (not accessory-only). */
  private hasMainEquipment(order: OrderDto): boolean {
    return (order.equipmentDefinitionIds ?? []).some((id) => id.trim().length > 0);
  }

  private mergeSystemSlotIds(group: CustomerBreakdown, order: OrderDto): void {
    const known = new Set(group.systemSlotIds);
    for (const slotId of order.equipmentDefinitionIds ?? []) {
      const trimmed = slotId.trim();
      if (!trimmed || known.has(trimmed)) {
        continue;
      }
      group.systemSlotIds.push(trimmed);
      known.add(trimmed);
    }
  }

  private sortSystemSlotIds(slotIds: string[]): string[] {
    const orderById = new Map(
      this.equipmentSlots.definitions().map((def) => [def.id, def.sortOrder] as const)
    );
    return [...slotIds].sort((a, b) => {
      const orderA = orderById.get(a) ?? 9999;
      const orderB = orderById.get(b) ?? 9999;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.localeCompare(b, 'he');
    });
  }

  private mergeEquipmentLine(map: Map<string, EquipmentLine>, line: EquipmentLine): void {
    const existing = map.get(line.label);
    if (!existing) {
      map.set(line.label, { ...line });
      return;
    }
    existing.quantity += line.quantity;
    existing.sortKey = Math.min(existing.sortKey, line.sortKey);
  }

  private sortEquipmentLines(map: Map<string, EquipmentLine>): EquipmentLine[] {
    return [...map.values()].sort((a, b) => {
      if (a.sortKey !== b.sortKey) {
        return a.sortKey - b.sortKey;
      }
      return a.label.localeCompare(b.label, 'he');
    });
  }

  private sortAccessoryRows(rows: CustomerAccessoryLine[]): CustomerAccessoryLine[] {
    return [...rows].sort((a, b) => {
      if (a.sortKey !== b.sortKey) {
        return a.sortKey - b.sortKey;
      }
      if (a.orderId !== b.orderId) {
        return a.orderId - b.orderId;
      }
      return a.label.localeCompare(b.label, 'he');
    });
  }

  private buildSameDayLastNameDuplicateOrderIds(orders: OrderDto[], iso: string): Set<number> {
    // lastName → customerIdentity → orderIds
    // Flag only when 2+ distinct customers (name+phone) share a last name that day.
    const buckets = new Map<string, Map<string, Set<number>>>();

    for (const order of orders) {
      const hasShiftOnDay = (order.shifts ?? []).some((shift) => shift.orderDate === iso);
      if (!hasShiftOnDay) {
        continue;
      }
      const lastNameKey = this.customerLastNameKey(order.customerName);
      if (!lastNameKey) {
        continue;
      }
      const customerIdentity = `${(order.customerName ?? '').trim()}|${order.phone}`;
      let byCustomer = buckets.get(lastNameKey);
      if (!byCustomer) {
        byCustomer = new Map();
        buckets.set(lastNameKey, byCustomer);
      }
      let orderIds = byCustomer.get(customerIdentity);
      if (!orderIds) {
        orderIds = new Set();
        byCustomer.set(customerIdentity, orderIds);
      }
      orderIds.add(order.id);
    }

    const flagged = new Set<number>();
    for (const byCustomer of buckets.values()) {
      if (byCustomer.size < 2) {
        continue;
      }
      for (const orderIds of byCustomer.values()) {
        for (const id of orderIds) {
          flagged.add(id);
        }
      }
    }
    return flagged;
  }

  private customerLastNameKey(fullName: string | null | undefined): string {
    const normalized = (fullName ?? '').trim().replace(/\s+/g, ' ');
    if (!normalized) {
      return '';
    }
    const parts = normalized.split(' ');
    const lastName = parts[parts.length - 1] ?? '';
    return lastName.toLocaleLowerCase('he-IL');
  }

  private hebrewPartsToIso(year: number, month: number, day: number): string | null {
    if (!year || !month || !day) {
      return null;
    }
    return this.hebrew.toIso(this.hebrew.toGregorian(year, month, day));
  }

  private buildYearOptions(): number[] {
    const current = this.hebrew.toHebrewParts(new Date()).year;
    const base = Array.from({ length: 7 }, (_, i) => current - 3 + i);
    const extras = this.extraYearsSig();
    return [...new Set([...base, ...extras])].sort((a, b) => a - b);
  }

  private ensureYearInOptions(year: number): void {
    if (!year || this.yearOptions().includes(year)) {
      return;
    }
    this.extraYearsSig.update((years) => [...years, year]);
  }
}
