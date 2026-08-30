import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { finalize } from 'rxjs';
import { distinctUntilChanged, map, startWith, switchMap } from 'rxjs/operators';

import { AccessorySerialLocationDto } from '../../core/models/accessory-inventory.model';
import {
  EquipmentDefaultAccessoryDto
} from '../../core/models/equipment-default-accessory.model';
import {
  EquipmentDefinitionDeleteFutureOrder,
  EquipmentDefinitionDto
} from '../../core/models/equipment-definition.model';
import {
  InventoryDefinitionDto,
  InventorySerialPhysicalStatus,
  InventorySerialUnitDto,
  InventoryHolderDto
} from '../../core/models/inventory-definition.model';
import {
  ActiveOneTimeAccessoryLoanDto,
  UnreturnedItemDto
} from '../../core/models/equipment-return.model';
import { OrderDto } from '../../core/models/order.model';
import {
  LOANED_EQUIPMENT_LABELS,
  LOANED_EQUIPMENT_ORDER,
  LoanedEquipmentType
} from '../../core/models/enums';
import { DataService } from '../../core/services/data.service';
import { EquipmentDefinitionsStore } from '../../core/services/equipment-definitions.store';
import { EquipmentMaintenanceSyncService } from '../../core/services/equipment-maintenance-sync.service';
import { HebrewDateService } from '../../core/services/hebrew-date.service';
import {
  InventoryDefinitionsStore
} from '../../core/services/inventory-definitions.store';
import { ToastService } from '../../core/services/toast.service';
import { WorkspaceUiService } from '../../core/services/workspace-ui.service';
import { compareNumericCodes, sortNumericCodes } from '../../core/utils/numeric-code-sort';
import { IntegerOnlyDirective } from '../../shared/directives/integer-only.directive';

const nonEmptyStringArrayValidator: ValidatorFn = (
  control: AbstractControl
): ValidationErrors | null => {
  const value = control.value;
  if (!Array.isArray(value) || value.length === 0) {
    return { required: true };
  }
  return null;
};

interface DefaultAccessoryCodeOption {
  value: string;
  label: string;
  disabled: boolean;
}

@Component({
  selector: 'app-equipment-slots-admin',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ReactiveFormsModule, IntegerOnlyDirective, RouterLink],
  templateUrl: './equipment-slots-admin.component.html',
  styleUrl: './equipment-slots-admin.component.scss'
})
export class EquipmentSlotsAdminComponent implements OnInit {
  private readonly data = inject(DataService);
  private readonly store = inject(EquipmentDefinitionsStore);
  private readonly inventoryStore = inject(InventoryDefinitionsStore);
  private readonly maintenanceSync = inject(EquipmentMaintenanceSyncService);
  private readonly toast = inject(ToastService);
  private readonly hebrew = inject(HebrewDateService);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly pageTitle = inject(WorkspaceUiService).title('ניהול ציוד');

  /** Shared sorted inventory catalog (A–Z) — same source as loan / lookup screens. */
  protected readonly inventoryCatalog = this.inventoryStore.definitions;

  /**
   * Local row order for the editable inventory table (kept stable during an edit session).
   * Rebuilt from the shared store on full load / batch save.
   */
  protected readonly customInventoryDefinitions = signal<InventoryDefinitionDto[]>([]);

  protected readonly accessoryLoading = signal(true);
  protected readonly serialSearchLoading = signal(false);
  protected readonly serialLocationResult = signal<AccessorySerialLocationDto | null>(null);
  /** True when the single-code locator result came from a one-time accessory loan. */
  protected readonly serialLocationIsOneTime = signal(false);
  /** Type-only locator result (no item code). */
  protected readonly typeLocatorResult = signal<{
    kind: 'catalog' | 'oneTime';
    label: string;
    quantity: number;
    statusLabel: string;
    holders: InventoryHolderDto[];
    loans: ActiveOneTimeAccessoryLoanDto[];
  } | null>(null);
  protected readonly serialSearchAttempted = signal(false);
  protected readonly serialTypeQuery = signal('');
  protected readonly serialTypePickerOpen = signal(false);
  /** Selected one-time item name when locator target is not a catalog definition. */
  protected readonly selectedOneTimeTypeName = signal('');
  /**
   * Active free-text loans with no matching permanent inventory catalog row.
   * Used by locator search only — not shown as separate grid rows.
   */
  protected readonly oneTimeAccessoryLoans = signal<ActiveOneTimeAccessoryLoanDto[]>([]);
  protected readonly oneTimeLoanDetails = signal<ActiveOneTimeAccessoryLoanDto | null>(null);
  protected readonly returningOneTimeKey = signal<string | null>(null);

  protected readonly serialSearchForm = this.fb.group({
    inventoryDefinitionId: this.fb.control<number | null>(null),
    serialCode: ['']
  });

  /** Catalog options for איתור פריט, filtered by typed query (catalog already A–Z). */
  protected readonly filteredSerialTypes = computed(() => {
    const query = this.serialTypeQuery().trim().toLowerCase();
    const digitsQuery = query.replace(/\D/g, '');
    const all = this.inventoryCatalog();
    if (!query) {
      return all;
    }
    return all.filter((d) => {
      if (d.displayName.toLowerCase().includes(query)) {
        return true;
      }
      const codes = [
        ...(d.serialCodes ?? []),
        ...(d.serialUnits ?? []).map((u) => u.serialCode)
      ];
      return codes.some((c) => (c ?? '').toLowerCase().includes(query) || (digitsQuery && (c ?? '').includes(digitsQuery)));
    });
  });

  /** One-time loan names (not in catalog) offered in the type picker when typing. */
  protected readonly filteredOneTimeTypeNames = computed(() => {
    const query = this.serialTypeQuery().trim().toLowerCase();
    const digitsQuery = query.replace(/\D/g, '');
    const catalogNames = new Set(
      this.inventoryCatalog().map((d) => d.displayName.trim().toLowerCase())
    );
    const matchingLoans = this.oneTimeAccessoryLoans().filter((loan) => {
      const name = (loan.itemName ?? '').trim();
      if (!name || catalogNames.has(name.toLowerCase())) {
        return false;
      }
      if (!query) {
        return true;
      }
      if (name.toLowerCase().includes(query)) {
        return true;
      }
      if ((loan.customerName ?? '').toLowerCase().includes(query)) {
        return true;
      }
      if (String(loan.orderId).includes(query) || String(loan.orderId).includes(digitsQuery)) {
        return true;
      }
      const phoneDigits = (loan.phone ?? '').replace(/\D/g, '');
      if (digitsQuery && phoneDigits.includes(digitsQuery)) {
        return true;
      }
      return (loan.serialCodes ?? []).some((c) => (c ?? '').toLowerCase().includes(query));
    });

    return [
      ...new Set(matchingLoans.map((l) => (l.itemName ?? '').trim()).filter((n) => n.length > 0))
    ].sort((a, b) => a.localeCompare(b, 'he'));
  });

  /** Permanent inventory catalog table rows (unfiltered — search lives in איתור פריט). */
  protected readonly inventoryTableRows = computed(() =>
    this.customInventoryDefinitions().map((def, formIndex) => ({
      kind: 'catalog' as const,
      def,
      formIndex
    }))
  );

  protected readonly customInventoryForm = this.fb.group({
    rows: this.fb.array<FormGroup>([])
  });

  protected readonly anyModalOpen = computed(
    () =>
      this.addSlotOpen() ||
      this.addInventoryOpen() ||
      this.editOpen() ||
      this.futureOrdersModal() !== null ||
      this.defaultAccessoriesOpen() ||
      this.oneTimeLoanDetails() !== null
  );

  constructor() {
    effect(() => {
      const v = this.maintenanceSync.version();
      if (v === 0) {
        return;
      }
      untracked(() => this.refresh());
    });

    effect(() => {
      if (typeof document !== 'undefined') {
        document.body.classList.toggle('modal-open-lock', this.anyModalOpen());
      }
    });

    this.destroyRef.onDestroy(() => {
      if (typeof document !== 'undefined') {
        document.body.classList.remove('modal-open-lock');
      }
    });

    this.defaultAccessoryForm.controls.accessorySerialCodes.addValidators(
      this.noTakenAccessoryCodesValidator
    );

    effect(() => {
      const taken = this.defaultAccessoryTakenCodeKeys();
      untracked(() => {
        const ctrl = this.defaultAccessoryForm.controls.accessorySerialCodes;
        const current = ctrl.value ?? [];
        const next = current.filter((c) => !taken.has(String(c).trim().toLowerCase()));
        if (next.length !== current.length) {
          ctrl.setValue(next);
        }
        ctrl.updateValueAndValidity({ emitEvent: false });
      });
    });
  }

  protected readonly saving = signal(false);
  protected readonly inventorySaving = signal(false);
  protected readonly editSaving = signal(false);
  protected readonly editOpen = signal(false);
  protected readonly addSlotOpen = signal(false);
  protected readonly addInventoryOpen = signal(false);
  protected readonly editingInventoryRowId = signal<number | null>(null);
  protected readonly savingInventoryRowId = signal<number | null>(null);
  private readonly inventoryRowSnapshots = new Map<
    number,
    { displayName: string; quantity: number; codes: string[] }
  >();

  /** Default accessories bound to a specific Mixer unit code. */
  protected readonly defaultAccessoriesOpen = signal(false);
  protected readonly defaultAccessoriesLoading = signal(false);
  protected readonly defaultAccessoriesSaving = signal(false);
  protected readonly defaultAccessoriesDeletingId = signal<number | null>(null);
  protected readonly defaultAccessoriesParentType = signal<LoanedEquipmentType | null>(null);
  protected readonly defaultAccessoriesParentSerial = signal('');
  protected readonly defaultAccessoriesParentLabel = signal('');
  protected readonly defaultAccessoriesList = signal<EquipmentDefaultAccessoryDto[]>([]);
  /** Key: `${type}|${serialCode}` (case-insensitive serial). */
  protected readonly defaultAccessoryCounts = signal<Map<string, number>>(new Map());

  /** Fresh inventory catalog loaded from API whenever the modal opens. */
  protected readonly defaultAccessoryCatalogLoading = signal(false);
  protected readonly defaultAccessoryCatalogLoadFailed = signal(false);
  protected readonly defaultAccessoryCatalog = signal<InventoryDefinitionDto[]>([]);

  protected readonly defaultAccessoryForm = this.fb.group({
    inventoryDefinitionId: this.fb.control<number | null>(null, Validators.required),
    accessorySerialCodes: this.fb.nonNullable.control<string[]>([], nonEmptyStringArrayValidator)
  });

  /** Selected catalog row id — drives code options reactively. */
  protected readonly defaultAccessorySelectedDefinitionId = signal<number | null>(null);
  protected readonly defaultAccessoryCodesPickerOpen = signal(false);
  protected readonly defaultAccessoryCodeFilter = signal('');

  /**
   * Full inventory master-table list for the type dropdown.
   * Bound to a fresh catalog fetch (no hardcoded / cached type subsets).
   */
  protected readonly defaultAccessoryTypeOptions = computed(() =>
    this.buildDefaultAccessoryTypeOptions(this.defaultAccessoryCatalog())
  );

  protected readonly defaultAccessoryCodeOptions = computed((): DefaultAccessoryCodeOption[] => {
    const defId = this.defaultAccessorySelectedDefinitionId();
    if (defId == null) {
      return [];
    }
    const parentSerial = this.defaultAccessoriesParentSerial().trim();
    const fromCatalog = this.serialCodesForDefinitionId(defId, this.defaultAccessoryCatalog());
    const fromLiveForm = this.liveFormSerialCodesForDefinitionId(defId);
    const assigned = new Set(
      this.defaultAccessoriesList()
        .filter((a) => a.inventoryDefinitionId === defId)
        .map((a) => a.accessorySerialCode.trim().toLowerCase())
    );
    const merged = new Map<string, string>();
    for (const code of [...fromCatalog, ...fromLiveForm]) {
      const trimmed = code.trim();
      if (!trimmed) {
        continue;
      }
      const key = trimmed.toLowerCase();
      if (!assigned.has(key) && !merged.has(key)) {
        merged.set(key, trimmed);
      }
    }
    return [...merged.values()]
      .sort(compareNumericCodes)
      .map((value) => {
        const disabled = this.isAccessoryCodeUnavailable(defId, value, parentSerial);
        return {
          value,
          label: disabled ? `${value} (תפוס)` : value,
          disabled
        };
      });
  });

  protected readonly filteredDefaultAccessoryCodeOptions = computed(() => {
    const query = this.defaultAccessoryCodeFilter().trim().toLowerCase();
    const options = this.defaultAccessoryCodeOptions();
    if (!query) {
      return options;
    }
    return options.filter((opt) => opt.value.toLowerCase().includes(query));
  });

  protected readonly defaultAccessoryTakenCodeKeys = computed(() => {
    const taken = new Set<string>();
    for (const opt of this.defaultAccessoryCodeOptions()) {
      if (opt.disabled) {
        taken.add(opt.value.trim().toLowerCase());
      }
    }
    return taken;
  });

  private readonly noTakenAccessoryCodesValidator: ValidatorFn = (control) => {
    const value = control.value;
    if (!Array.isArray(value) || value.length === 0) {
      return null;
    }
    const taken = this.defaultAccessoryTakenCodeKeys();
    const blocked = value.some((c) => taken.has(String(c).trim().toLowerCase()));
    return blocked ? { taken: true } : null;
  };

  protected readonly deletingInventoryId = signal<number | null>(null);
  protected readonly editingId = signal<string | null>(null);
  protected readonly deletingId = signal<string | null>(null);
  protected readonly futureOrdersModal = signal<EquipmentDefinitionDeleteFutureOrder[] | null>(null);
  protected readonly maintenanceTogglingId = signal<string | null>(null);
  protected readonly serialStatusMenu = signal<{
    inventoryDefinitionId: number;
    serialCode: string;
    x: number;
    y: number;
    currentStatus: InventorySerialPhysicalStatus;
  } | null>(null);
  protected readonly serialStatusSaving = signal(false);

  /** Creates a single booking-slot column on the weekly board (not accessory inventory). */
  protected readonly addSlotForm = this.fb.group({
    displayName: ['', [Validators.required, Validators.maxLength(200)]],
    code: [
      '',
      [
        Validators.required,
        Validators.maxLength(64),
        Validators.pattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
      ]
    ]
  });

  /**
   * Creates a standalone inventory definition (name + optional qty/serials).
   * Saved via POST /api/inventory-definitions — never to EquipmentDefinitions.
   */
  protected readonly addInventoryForm = this.fb.group({
    displayName: ['', [Validators.required, Validators.maxLength(200)]],
    quantity: [0 as number | null, [Validators.min(0), Validators.max(200)]],
    codes: this.fb.array<FormControl<string>>([])
  });

  protected readonly editForm = this.fb.group({
    displayName: ['', [Validators.required, Validators.maxLength(200)]],
    sortOrder: [0, [Validators.required, Validators.min(0), Validators.max(1_000_000)]]
  });

  ngOnInit(): void {
    this.wireSerialSearchTypeFilter();
    this.wireAddInventoryQuantitySync();
    this.refresh();
  }

  protected isBoardColumnCategory(category: string | null | undefined): boolean {
    return EquipmentDefinitionsStore.isBoardColumnCategory(category);
  }

  protected serialCodesForSearchType(): string[] {
    const id = this.serialSearchForm.controls.inventoryDefinitionId.value;
    if (id != null) {
      const def = this.inventoryStore.byId(id);
      return sortNumericCodes(def?.serialCodes ?? []);
    }

    const oneTimeName = this.selectedOneTimeTypeName().trim().toLowerCase();
    if (!oneTimeName) {
      return [];
    }
    const codes = this.oneTimeAccessoryLoans()
      .filter((l) => (l.itemName ?? '').trim().toLowerCase() === oneTimeName)
      .flatMap((l) => l.serialCodes ?? [])
      .map((c) => (c ?? '').trim())
      .filter((c) => c.length > 0);
    return sortNumericCodes([...new Set(codes)]);
  }

  protected selectedSerialTypeLabel(): string {
    const id = this.serialSearchForm.controls.inventoryDefinitionId.value;
    if (id != null) {
      return this.inventoryStore.byId(id)?.displayName ?? '';
    }
    return this.selectedOneTimeTypeName();
  }

  protected onSerialTypeQueryInput(value: string): void {
    this.serialTypeQuery.set(value);
    this.serialTypePickerOpen.set(true);
    // Free-text typing clears a prior selection so search resolves from the query.
    const selected = this.selectedSerialTypeLabel();
    if (selected && value.trim() !== selected.trim()) {
      this.serialSearchForm.patchValue({ inventoryDefinitionId: null }, { emitEvent: false });
      this.selectedOneTimeTypeName.set('');
    }
  }

  protected onSerialTypeFocus(): void {
    const selected = this.selectedSerialTypeLabel();
    if (this.serialTypeQuery().trim() === selected.trim()) {
      this.serialTypeQuery.set('');
    }
    this.serialTypePickerOpen.set(true);
  }

  protected onSerialTypeBlur(): void {
    // Delay so option mousedown/click can run before the list closes.
    window.setTimeout(() => {
      this.serialTypePickerOpen.set(false);
      this.syncSerialTypeQueryFromSelection();
    }, 150);
  }

  protected onSerialTypeChosen(def: InventoryDefinitionDto): void {
    this.serialSearchForm.patchValue({ inventoryDefinitionId: def.id });
    this.selectedOneTimeTypeName.set('');
    this.serialTypeQuery.set(def.displayName);
    this.serialTypePickerOpen.set(false);
  }

  protected onOneTimeTypeNameChosen(name: string): void {
    this.serialSearchForm.patchValue({ inventoryDefinitionId: null });
    this.selectedOneTimeTypeName.set(name);
    this.serialTypeQuery.set(name);
    this.serialTypePickerOpen.set(false);
  }

  private syncSerialTypeQueryFromSelection(): void {
    const selected = this.selectedSerialTypeLabel();
    if (selected) {
      this.serialTypeQuery.set(selected);
    }
  }

  protected searchSerialLocation(): void {
    const serialCode = (this.serialSearchForm.controls.serialCode.value ?? '').trim();
    const resolved = this.resolveSerialSearchTarget();

    if (!resolved) {
      this.serialSearchForm.controls.inventoryDefinitionId.markAsTouched();
      this.toast.error('יש לבחור או להזין סוג אביזר לחיפוש');
      return;
    }

    this.typeLocatorResult.set(null);
    this.serialLocationResult.set(null);
    this.serialLocationIsOneTime.set(false);

    if (!serialCode) {
      this.showTypeOnlySearchResult(resolved);
      return;
    }

    if (resolved.kind === 'oneTime') {
      this.serialSearchAttempted.set(true);
      this.serialLocationIsOneTime.set(true);
      const loan = resolved.loans.find((l) =>
        (l.serialCodes ?? []).some(
          (c) => c.localeCompare(serialCode, undefined, { sensitivity: 'accent' }) === 0
        )
      );
      if (!loan) {
        this.serialLocationResult.set({
          equipmentType: LoanedEquipmentType.Connectors,
          label: resolved.label,
          serialCode,
          isRegistered: false,
          isInWarehouse: false,
          isMissing: false
        });
        return;
      }
      this.serialLocationResult.set({
        equipmentType: LoanedEquipmentType.Connectors,
        label: resolved.label,
        serialCode,
        isRegistered: true,
        isInWarehouse: false,
        isMissing: false,
        orderId: loan.orderId,
        customerName: loan.customerName ?? null,
        phone: loan.phone ?? null,
        address: loan.address ?? null,
        loanDate: loan.loanDate ?? null
      });
      return;
    }

    const def = resolved.def;
    this.serialSearchForm.patchValue({ inventoryDefinitionId: def.id }, { emitEvent: false });

    this.serialSearchLoading.set(true);
    this.serialSearchAttempted.set(true);
    this.data
      .getAccessorySerialLocation(def.id, serialCode)
      .pipe(
        switchMap((result) => {
          if (!result) {
            return of(null);
          }
          const enriched = this.enrichSerialLocationFromCatalog(result, def, serialCode);
          if (this.serialLocationHasCustomerDetails(enriched)) {
            return of(enriched);
          }
          const orderId = enriched.orderId;
          if (orderId != null && orderId > 0) {
            return this.data.getOrderById(orderId).pipe(
              map((order) => (order ? this.mergeOrderIntoSerialLocation(enriched, order) : enriched))
            );
          }
          return of(enriched);
        }),
        finalize(() => this.serialSearchLoading.set(false))
      )
      .subscribe((result) => {
        if (result) {
          this.serialLocationResult.set(result);
        }
      });
  }

  /** True when the locator card can show customer / order fields. */
  private serialLocationHasCustomerDetails(result: AccessorySerialLocationDto): boolean {
    return Boolean(
      (result.customerName ?? '').trim()
        || (result.phone ?? '').trim()
        || (result.orderId != null && result.orderId > 0)
    );
  }

  /**
   * When the location API marks a unit as loaned but omits holder fields, fill from the
   * already-loaded catalog (activeHolders / serialUnits) — same source as the inventory grid.
   */
  private enrichSerialLocationFromCatalog(
    result: AccessorySerialLocationDto,
    def: InventoryDefinitionDto,
    serialCode: string
  ): AccessorySerialLocationDto {
    if (result.isInWarehouse || result.isMissing || this.serialLocationHasCustomerDetails(result)) {
      return result;
    }

    const code = serialCode.trim();
    const holder = (def.activeHolders ?? []).find(
      (h) =>
        (h.serialCode ?? '').trim().localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
    );
    if (holder) {
      return {
        ...result,
        orderId: holder.orderId ?? result.orderId ?? null,
        customerName: holder.customerName ?? result.customerName ?? null,
        phone: holder.phone ?? result.phone ?? null,
        address: holder.address ?? result.address ?? null,
        loanDate: holder.eventDate ?? result.loanDate ?? null
      };
    }

    const unit = (def.serialUnits ?? []).find(
      (u) => u.serialCode.trim().localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
    );
    if (!unit) {
      return result;
    }

    return {
      ...result,
      customerName: unit.holderCustomerName ?? result.customerName ?? null,
      phone: unit.holderPhone ?? result.phone ?? null,
      address: unit.holderAddress ?? result.address ?? null,
      loanDate: unit.markedMissingAt ?? result.loanDate ?? null
    };
  }

  private mergeOrderIntoSerialLocation(
    result: AccessorySerialLocationDto,
    order: OrderDto
  ): AccessorySerialLocationDto {
    const loanDate =
      result.loanDate ??
      order.shifts?.map((s) => s.orderDate).sort()[0] ??
      null;

    return {
      ...result,
      orderId: result.orderId ?? order.id,
      customerName: (result.customerName ?? order.customerName ?? '').trim() || null,
      phone: (result.phone ?? order.phone ?? '').trim() || null,
      phone2: (result.phone2 ?? order.phone2 ?? '').trim() || null,
      address: (result.address ?? order.address ?? '').trim() || null,
      deposit: (result.deposit ?? order.depositOnName ?? '').trim() || null,
      notes: (result.notes ?? order.notes ?? '').trim() || null,
      loanDate
    };
  }

  private resolveSerialSearchTarget():
    | { kind: 'catalog'; def: InventoryDefinitionDto; label: string }
    | { kind: 'oneTime'; label: string; loans: ActiveOneTimeAccessoryLoanDto[] }
    | null {
    const id = this.serialSearchForm.controls.inventoryDefinitionId.value;
    if (id != null) {
      const def = this.inventoryStore.byId(id);
      if (def) {
        return { kind: 'catalog', def, label: def.displayName };
      }
    }

    const selectedOneTime = this.selectedOneTimeTypeName().trim();
    if (selectedOneTime) {
      const lower = selectedOneTime.toLowerCase();
      const loans = this.oneTimeAccessoryLoans().filter(
        (l) => (l.itemName ?? '').trim().toLowerCase() === lower
      );
      if (loans.length > 0) {
        return { kind: 'oneTime', label: selectedOneTime, loans };
      }
    }

    const query = this.serialTypeQuery().trim();
    if (!query) {
      return null;
    }

    const lower = query.toLowerCase();
    const catalog = this.inventoryCatalog();
    const exact = catalog.find((d) => d.displayName.trim().toLowerCase() === lower);
    if (exact) {
      return { kind: 'catalog', def: exact, label: exact.displayName };
    }

    const partial = catalog.filter((d) => d.displayName.toLowerCase().includes(lower));
    if (partial.length === 1) {
      return { kind: 'catalog', def: partial[0], label: partial[0].displayName };
    }
    if (partial.length > 1) {
      // Prefer exact-ish shortest name match when multiple partials exist.
      const best = [...partial].sort(
        (a, b) => a.displayName.length - b.displayName.length
      )[0];
      return { kind: 'catalog', def: best, label: best.displayName };
    }

    const loans = this.oneTimeAccessoryLoans().filter((l) =>
      (l.itemName ?? '').toLowerCase().includes(lower)
    );
    if (loans.length > 0) {
      const label =
        loans.find((l) => (l.itemName ?? '').trim().toLowerCase() === lower)?.itemName?.trim() ||
        loans[0].itemName.trim() ||
        query;
      return { kind: 'oneTime', label, loans };
    }

    return null;
  }

  private showTypeOnlySearchResult(
    resolved:
      | { kind: 'catalog'; def: InventoryDefinitionDto; label: string }
      | { kind: 'oneTime'; label: string; loans: ActiveOneTimeAccessoryLoanDto[] }
  ): void {
    this.serialSearchAttempted.set(true);

    if (resolved.kind === 'catalog') {
      const def = resolved.def;
      this.serialSearchForm.patchValue({ inventoryDefinitionId: def.id }, { emitEvent: false });
      this.serialTypeQuery.set(def.displayName);
      this.typeLocatorResult.set({
        kind: 'catalog',
        label: def.displayName,
        quantity: def.totalQuantity ?? 0,
        statusLabel: this.inventoryRowStatusLabel(def),
        holders: def.activeHolders ?? [],
        loans: []
      });
      return;
    }

    const outstanding = resolved.loans.reduce((sum, l) => sum + (l.outstandingQuantity || 0), 0);
    this.selectedOneTimeTypeName.set(resolved.label);
    this.serialTypeQuery.set(resolved.label);
    this.typeLocatorResult.set({
      kind: 'oneTime',
      label: resolved.label,
      quantity: outstanding,
      statusLabel: 'בהשאלה',
      holders: [],
      loans: resolved.loans
    });
  }

  protected clearSerialSearch(): void {
    this.serialSearchAttempted.set(false);
    this.serialLocationResult.set(null);
    this.serialLocationIsOneTime.set(false);
    this.typeLocatorResult.set(null);
    this.serialSearchForm.patchValue({ serialCode: '', inventoryDefinitionId: null });
    this.selectedOneTimeTypeName.set('');
    this.serialTypeQuery.set('');
  }

  protected formatLocatorPhone(phone: string | null | undefined): string {
    const digits = (phone ?? '').replace(/\D/g, '');
    if (digits.length === 10) {
      return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
    }
    return phone ?? '';
  }

  /** Hebrew calendar date for a loaned-item locator card (from order shift date). */
  protected formatLocatorHebrewDate(loanDate: string | null | undefined): string {
    const iso = (loanDate ?? '').trim();
    if (!iso) {
      return '—';
    }
    const date = this.hebrew.parseIso(iso);
    return date ? this.hebrew.toHebrew(date) : '—';
  }

  protected focusNextSerialInput(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const current = event.target;
    if (!(current instanceof HTMLInputElement)) {
      return;
    }

    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input.note-input[data-serial-nav="1"]')
    );
    const index = inputs.indexOf(current);
    if (index < 0 || index >= inputs.length - 1) {
      return;
    }

    const next = inputs[index + 1];
    next.focus();
    next.select();
  }

  protected refresh(): void {
    this.store.invalidate();
    this.store.load().subscribe();
    this.loadAccessoryInventory();
    this.loadDefaultAccessoryCounts();
  }

  protected loadAccessoryInventory(): void {
    this.accessoryLoading.set(true);
    this.inventoryStore.invalidate();
    forkJoin({
      inventory: this.inventoryStore.load({ force: true }),
      oneTimeApi: this.data.getActiveOneTimeAccessories(),
      quickLoans: this.data.getQuickLoans(),
      unreturned: this.data.getUnreturnedItems()
    })
      .pipe(finalize(() => this.accessoryLoading.set(false)))
      .subscribe(({ oneTimeApi, quickLoans, unreturned }) => {
        const list = this.inventoryStore.definitions();
        this.customInventoryDefinitions.set(list);
        this.rebuildCustomInventoryRows(list);
        this.ensureSerialSearchSelection(list);
        const catalogNames = new Set(
          list.map((d) => d.displayName.trim().toLowerCase()).filter((n) => n.length > 0)
        );
        // Same sources as Active Loans: open custom order lines + custom manual reports.
        this.oneTimeAccessoryLoans.set(
          this.buildOneTimeAccessoryLoans(
            quickLoans ?? [],
            unreturned ?? [],
            oneTimeApi ?? [],
            catalogNames
          )
        );
      });
  }

  /**
   * Merge active one-time / custom accessories for איתור פריט.
   * Catalog names are never treated as one-time rows.
   */
  private buildOneTimeAccessoryLoans(
    orders: OrderDto[],
    unreturned: UnreturnedItemDto[],
    apiRows: ActiveOneTimeAccessoryLoanDto[],
    catalogNames: Set<string>
  ): ActiveOneTimeAccessoryLoanDto[] {
    const byKey = new Map<string, ActiveOneTimeAccessoryLoanDto>();

    const remember = (key: string, row: ActiveOneTimeAccessoryLoanDto): void => {
      const name = (row.itemName ?? '').trim();
      if (!name || catalogNames.has(name.toLowerCase())) {
        return;
      }
      if (!byKey.has(key)) {
        byKey.set(key, { ...row, itemName: name });
      }
    };

    for (const order of orders ?? []) {
      if (order.isCancelled || order.isReturnProcessed) {
        continue;
      }
      const loanDate = order.shifts?.[0]?.orderDate ?? null;
      for (const le of order.loanedEquipments ?? []) {
        if (!le.isCustomItem || le.id == null || le.id <= 0 || le.quantity <= 0) {
          continue;
        }
        const returned = le.returnedQuantity ?? 0;
        if (returned >= le.quantity) {
          continue;
        }
        const codes = (le.notes ?? [])
          .filter((n) => !n.isReturned)
          .map((n) => (n.content ?? '').trim())
          .filter((c) => c.length > 0);
        remember(`o:${order.id}:${le.id}`, {
          orderId: order.id,
          loanedEquipmentId: le.id,
          manualItemId: null,
          itemName: (le.customItemName ?? '').trim() || 'פריט נוסף',
          quantity: le.quantity,
          outstandingQuantity: Math.max(0, le.quantity - returned),
          customerName: order.customerName ?? null,
          phone: order.phone ?? '',
          address: order.address ?? null,
          loanDate,
          serialCodes: codes
        });
      }
    }

    for (const u of unreturned ?? []) {
      // Backend already marks permanent catalog leftovers as isCustomItem=false.
      if (!u.isCustomItem) {
        continue;
      }
      const name = (u.equipmentName ?? '').trim();
      if (!name) {
        continue;
      }
      if (u.manualItemId != null && u.manualItemId > 0) {
        remember(`m:${u.manualItemId}`, {
          orderId: u.orderId ?? 0,
          loanedEquipmentId: 0,
          manualItemId: u.manualItemId,
          itemName: name,
          quantity: u.quantityLoaned || 1,
          outstandingQuantity: u.missingQuantity || 1,
          customerName: u.customerName ?? null,
          phone: u.phone ?? '',
          address: u.address ?? null,
          loanDate: u.returnDate ?? null,
          serialCodes: [...(u.assignedSerialCodes ?? []), ...(u.missingSerialCodes ?? [])].filter(
            (c, i, arr) => !!c && arr.indexOf(c) === i
          )
        });
        continue;
      }
      if (u.loanedEquipmentId > 0 && u.orderId > 0) {
        remember(`o:${u.orderId}:${u.loanedEquipmentId}`, {
          orderId: u.orderId,
          loanedEquipmentId: u.loanedEquipmentId,
          manualItemId: null,
          itemName: name,
          quantity: u.quantityLoaned || 1,
          outstandingQuantity: u.missingQuantity || 1,
          customerName: u.customerName ?? null,
          phone: u.phone ?? '',
          address: u.address ?? null,
          loanDate: u.returnDate ?? null,
          serialCodes: [...(u.missingSerialCodes ?? [])]
        });
      }
    }

    for (const row of apiRows ?? []) {
      if (row.manualItemId != null && row.manualItemId > 0) {
        remember(`m:${row.manualItemId}`, row);
      } else if (row.loanedEquipmentId > 0 && row.orderId > 0) {
        remember(`o:${row.orderId}:${row.loanedEquipmentId}`, row);
      }
    }

    return [...byKey.values()].sort((a, b) =>
      (a.itemName ?? '').localeCompare(b.itemName ?? '', 'he')
    );
  }

  protected oneTimeLoanKey(loan: ActiveOneTimeAccessoryLoanDto): string {
    if (loan.manualItemId != null && loan.manualItemId > 0) {
      return `m:${loan.manualItemId}`;
    }
    return `${loan.orderId}:${loan.loanedEquipmentId}`;
  }

  protected openOneTimeLoanDetails(loan: ActiveOneTimeAccessoryLoanDto): void {
    this.oneTimeLoanDetails.set(loan);
  }

  protected closeOneTimeLoanDetails(): void {
    this.oneTimeLoanDetails.set(null);
  }

  protected markOneTimeLoanReturned(loan: ActiveOneTimeAccessoryLoanDto): void {
    if (this.returningOneTimeKey() !== null) {
      return;
    }

    const key = this.oneTimeLoanKey(loan);
    this.returningOneTimeKey.set(key);

    if (loan.manualItemId != null && loan.manualItemId > 0) {
      this.data
        .resolveManualUnreturnedItem(loan.manualItemId)
        .pipe(finalize(() => this.returningOneTimeKey.set(null)))
        .subscribe((ok) => {
          if (!ok) {
            return;
          }
          this.toast.success('הפריט סומן כהוחזר');
          this.closeOneTimeLoanDetails();
          this.loadAccessoryInventory();
        });
      return;
    }

    const assignedCodes = (loan.serialCodes ?? [])
      .map((c) => (c ?? '').trim())
      .filter((c) => c.length > 0);
    const hasSerializedLine = assignedCodes.length > 0;
    const quantityReturned = hasSerializedLine
      ? assignedCodes.length
      : Math.max(loan.quantity, loan.outstandingQuantity);

    this.data
      .recordOrderReturn(loan.orderId, {
        items: [
          {
            loanedEquipmentId: loan.loanedEquipmentId,
            quantityReturned,
            ...(hasSerializedLine ? { returnedSerialCodes: [...assignedCodes] } : {})
          }
        ]
      })
      .pipe(finalize(() => this.returningOneTimeKey.set(null)))
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.toast.success('הפריט סומן כהוחזר');
        this.closeOneTimeLoanDetails();
        this.loadAccessoryInventory();
      });
  }

  protected loadDefaultAccessoryCounts(): void {
    this.data.getEquipmentDefaultAccessoryCounts(LoanedEquipmentType.Mixer).subscribe((rows) => {
      const map = new Map<string, number>();
      for (const row of rows ?? []) {
        map.set(
          this.defaultAccessoryCountKey(row.parentEquipmentType, row.parentSerialCode),
          row.count
        );
      }
      this.defaultAccessoryCounts.set(map);
    });
  }

  private defaultAccessoryCountKey(
    type: LoanedEquipmentType,
    serialCode: string
  ): string {
    return `${type}|${serialCode.trim().toLowerCase()}`;
  }

  protected supportsDefaultAccessories(def: InventoryDefinitionDto): boolean {
    return this.isMixerInventoryDefinition(def);
  }

  protected isMixerInventoryDefinition(def: InventoryDefinitionDto): boolean {
    const mixerLabel = LOANED_EQUIPMENT_LABELS[LoanedEquipmentType.Mixer];
    return (
      def.displayName.trim().localeCompare(mixerLabel, 'he', { sensitivity: 'accent' }) === 0
    );
  }

  protected defaultAccessoryCountForUnit(
    type: LoanedEquipmentType | string | null | undefined,
    serialCode: string
  ): number {
    if (!type || typeof type !== 'string') {
      return 0;
    }
    const code = serialCode.trim();
    if (!code) {
      return 0;
    }
    return this.defaultAccessoryCounts().get(
      this.defaultAccessoryCountKey(type as LoanedEquipmentType, code)
    ) ?? 0;
  }

  protected inventoryRowHasDefaultAccessories(def: InventoryDefinitionDto, rowIndex: number): boolean {
    if (!this.supportsDefaultAccessories(def)) {
      return false;
    }
    const type = LoanedEquipmentType.Mixer;
    const codes = this.customInventoryCodesArray(rowIndex).controls
      .map((c) => String(c.value ?? '').trim())
      .filter((c) => c.length > 0);
    return codes.some((code) => this.defaultAccessoryCountForUnit(type, code) > 0);
  }

  protected customInventoryCodeValue(rowIndex: number, codeIndex: number): string {
    return String(this.customInventoryCodesArray(rowIndex).at(codeIndex)?.value ?? '').trim();
  }

  protected inventoryRowStatusLabel(def: InventoryDefinitionDto): string {
    return (def.aggregateStatusLabel ?? '').trim() || 'זמין';
  }

  protected inventoryRowStatusClass(def: InventoryDefinitionDto): string {
    const status = def.aggregateStatus ?? 'InWarehouse';
    if (status === 'Missing') {
      return 'inventory-row-status inventory-row-status--missing';
    }
    if (status === 'InRepair') {
      return 'inventory-row-status inventory-row-status--in-repair';
    }
    if (status === 'LoanedOut') {
      return 'inventory-row-status inventory-row-status--loaned';
    }
    return 'inventory-row-status inventory-row-status--available';
  }

  protected serialStatusFor(
    def: InventoryDefinitionDto,
    serialCode: string
  ): InventorySerialPhysicalStatus {
    const code = serialCode.trim();
    if (!code) {
      return 'InWarehouse';
    }
    const unit = (def.serialUnits ?? []).find(
      (u) => u.serialCode.localeCompare(code, undefined, { sensitivity: 'accent' }) === 0
    );
    return unit?.physicalStatus ?? 'InWarehouse';
  }

  protected isSerialInRepair(def: InventoryDefinitionDto, serialCode: string): boolean {
    return this.serialStatusFor(def, serialCode) === 'InRepair';
  }

  protected openSerialStatusMenu(
    def: InventoryDefinitionDto,
    serialCode: string,
    event: MouseEvent
  ): void {
    const code = serialCode.trim();
    if (!code || this.serialStatusSaving()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.serialStatusMenu.set({
      inventoryDefinitionId: def.id,
      serialCode: code,
      x: event.clientX,
      y: event.clientY,
      currentStatus: this.serialStatusFor(def, code)
    });
  }

  protected closeSerialStatusMenu(): void {
    if (this.serialStatusSaving()) {
      return;
    }
    this.serialStatusMenu.set(null);
  }

  protected setSerialStatusFromMenu(status: InventorySerialPhysicalStatus): void {
    const menu = this.serialStatusMenu();
    if (!menu || this.serialStatusSaving()) {
      return;
    }
    if (menu.currentStatus === status) {
      this.closeSerialStatusMenu();
      return;
    }

    this.serialStatusSaving.set(true);
    this.data
      .updateInventoryDefinitionSerialStatus(menu.inventoryDefinitionId, {
        serialCode: menu.serialCode,
        status
      })
      .pipe(finalize(() => this.serialStatusSaving.set(false)))
      .subscribe((updated) => {
        if (!updated) {
          return;
        }
        this.inventoryStore.upsert(updated);
        this.customInventoryDefinitions.update((defs) =>
          defs.map((d) => (d.id === updated.id ? updated : d))
        );
        this.serialStatusMenu.set(null);
      });
  }

  @HostListener('document:click', ['$event'])
  @HostListener('document:contextmenu')
  protected onDocumentPointerCloseMenu(event?: MouseEvent): void {
    this.closeSerialStatusMenu();
    const target = event?.target as HTMLElement | null;
    if (!target?.closest('.default-acc-code-picker')) {
      this.closeDefaultAccessoryCodesPicker();
    }
  }

  protected formatMissingMarkedAt(iso: string | null | undefined): string {
    const value = (iso ?? '').trim();
    if (!value) {
      return '—';
    }
    const date = this.hebrew.parseIso(value);
    if (!date) {
      return value;
    }
    const heb = this.hebrew.toHebrew(date);
    return heb
      ? `${this.hebrew.formatGregorianWithDayName(date)} · ${heb}`
      : this.hebrew.formatGregorianWithDayName(date);
  }

  protected openDefaultAccessoriesForUnit(
    def: InventoryDefinitionDto,
    rowIndex: number,
    codeIndex: number
  ): void {
    if (!this.supportsDefaultAccessories(def)) {
      return;
    }
    const parentSerial = this.customInventoryCodeValue(rowIndex, codeIndex);
    if (!parentSerial) {
      this.toast.warning('יש להזין קוד יחידה לפני ניהול ציוד נלווה');
      return;
    }

    const parent = LoanedEquipmentType.Mixer;
    const label = def.displayName || LOANED_EQUIPMENT_LABELS[parent];
    this.defaultAccessoriesParentType.set(parent);
    this.defaultAccessoriesParentSerial.set(parentSerial);
    this.defaultAccessoriesParentLabel.set(`${label} #${parentSerial}`);
    this.defaultAccessorySelectedDefinitionId.set(null);
    this.defaultAccessoryForm.reset({
      inventoryDefinitionId: null,
      accessorySerialCodes: []
    });
    this.syncDefaultAccessoryFormDisabledState({ catalogBlocked: true, codesEnabled: false });
    this.closeDefaultAccessoryCodesPicker();
    this.defaultAccessoriesList.set([]);
    this.defaultAccessoryCatalog.set([]);
    this.defaultAccessoriesOpen.set(true);
    this.loadDefaultAccessoriesModalData(parent, parentSerial);
  }

  protected closeDefaultAccessories(): void {
    this.defaultAccessoriesOpen.set(false);
    this.defaultAccessoriesParentType.set(null);
    this.defaultAccessoriesParentSerial.set('');
    this.defaultAccessoriesList.set([]);
    this.defaultAccessorySelectedDefinitionId.set(null);
    this.defaultAccessoryCatalog.set([]);
    this.defaultAccessoryCatalogLoadFailed.set(false);
    this.defaultAccessoryForm.reset({
      inventoryDefinitionId: null,
      accessorySerialCodes: []
    });
    this.closeDefaultAccessoryCodesPicker();
    this.syncDefaultAccessoryFormDisabledState({ catalogBlocked: false, codesEnabled: false });
  }

  /**
   * Drive disabled state via FormControl APIs only (never [disabled] + formControlName).
   * Avoids Angular reactive-forms warnings and change-detection churn.
   */
  private syncDefaultAccessoryFormDisabledState(opts?: {
    catalogBlocked?: boolean;
    codesEnabled?: boolean;
  }): void {
    const typeCtrl = this.defaultAccessoryForm.controls.inventoryDefinitionId;
    const codesCtrl = this.defaultAccessoryForm.controls.accessorySerialCodes;
    const catalogBlocked =
      opts?.catalogBlocked ??
      (this.defaultAccessoryCatalogLoading() || this.defaultAccessoryCatalogLoadFailed());
    const codesEnabled =
      opts?.codesEnabled ??
      (!catalogBlocked && this.defaultAccessorySelectedDefinitionId() != null);

    if (catalogBlocked) {
      typeCtrl.disable({ emitEvent: false });
      codesCtrl.disable({ emitEvent: false });
      return;
    }

    typeCtrl.enable({ emitEvent: false });
    if (codesEnabled) {
      codesCtrl.enable({ emitEvent: false });
    } else {
      codesCtrl.disable({ emitEvent: false });
    }
  }

  /** Loads assigned defaults + fresh inventory catalog from the server on every open. */
  private loadDefaultAccessoriesModalData(
    parent: LoanedEquipmentType,
    parentSerial: string
  ): void {
    this.defaultAccessoriesLoading.set(true);
    this.defaultAccessoryCatalogLoading.set(true);
    this.defaultAccessoryCatalogLoadFailed.set(false);
    this.defaultAccessoriesList.set([]);
    this.defaultAccessoryCatalog.set([]);
    this.syncDefaultAccessoryFormDisabledState({ catalogBlocked: true, codesEnabled: false });

    forkJoin({
      catalog: this.data.fetchInventoryDefinitionsCatalog(),
      assigned: this.data.fetchEquipmentDefaultAccessories(parent, parentSerial)
    })
      .pipe(
        finalize(() => {
          this.defaultAccessoriesLoading.set(false);
          this.defaultAccessoryCatalogLoading.set(false);
          this.syncDefaultAccessoryFormDisabledState();
        })
      )
      .subscribe({
        next: ({ catalog, assigned }) => {
          this.defaultAccessoryCatalog.set(this.mergeLiveFormSerialsIntoCatalog(catalog ?? []));
          this.defaultAccessoriesList.set(assigned ?? []);
          this.defaultAccessoryCounts.update((map) => {
            const next = new Map(map);
            next.set(this.defaultAccessoryCountKey(parent, parentSerial), (assigned ?? []).length);
            return next;
          });

          const selectedId = this.defaultAccessoryForm.controls.inventoryDefinitionId.value;
          if (
            selectedId != null &&
            !this.defaultAccessoryTypeOptions().some((o) => o.id === selectedId)
          ) {
            this.defaultAccessoryForm.patchValue({ inventoryDefinitionId: null });
            this.onDefaultAccessoryTypeChange();
          } else {
            this.syncDefaultAccessoryFormDisabledState();
          }
        },
        error: () => {
          this.defaultAccessoryCatalogLoadFailed.set(true);
          this.defaultAccessoriesList.set([]);
          this.defaultAccessoryCatalog.set([]);
          this.syncDefaultAccessoryFormDisabledState({ catalogBlocked: true, codesEnabled: false });
          this.toast.error('טעינת מלאי האביזרים נכשלה');
        }
      });
  }

  /**
   * Full inventory master list for the type dropdown — every catalog row.
   */
  private buildDefaultAccessoryTypeOptions(
    defs: InventoryDefinitionDto[]
  ): { id: number; label: string }[] {
    return defs
      .map((def) => ({
        id: def.id,
        label: def.displayName?.trim() || `פריט #${def.id}`
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'he'));
  }

  private serialCodesForDefinitionId(
    definitionId: number,
    catalog: InventoryDefinitionDto[]
  ): string[] {
    const def = catalog.find((d) => d.id === definitionId);
    return (def?.serialCodes ?? [])
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
  }

  private serialUnitForCode(
    definitionId: number,
    code: string
  ): InventorySerialUnitDto | undefined {
    const def = this.defaultAccessoryCatalog().find((d) => d.id === definitionId);
    const key = code.trim().toLowerCase();
    return (def?.serialUnits ?? []).find((u) => u.serialCode.trim().toLowerCase() === key);
  }

  private isAccessoryCodeUnavailable(
    definitionId: number,
    code: string,
    parentSerial: string
  ): boolean {
    const unit = this.serialUnitForCode(definitionId, code);
    if (!unit) {
      return false;
    }

    const status: InventorySerialPhysicalStatus | undefined = unit.physicalStatus;
    if (status === 'LoanedOut' || status === 'Missing' || status === 'InRepair') {
      return true;
    }

    if (unit.mixerId == null) {
      return false;
    }

    const mixerCode = (unit.mixerSerialCode ?? '').trim().toLowerCase();
    const currentMixer = parentSerial.trim().toLowerCase();
    return mixerCode.length === 0 || mixerCode !== currentMixer;
  }

  /** Serial codes currently typed in the inventory table for a catalog row. */
  private liveFormSerialCodesForDefinitionId(definitionId: number): string[] {
    const rows = this.customInventoryRows();
    for (let i = 0; i < rows.length; i++) {
      const group = rows.at(i) as FormGroup;
      if (Number(group.get('id')?.value) !== definitionId) {
        continue;
      }
      const codesFa = group.get('codes') as FormArray<FormControl<string>> | null;
      if (!codesFa) {
        return [];
      }
      return codesFa.controls
        .map((ctrl) => String(ctrl.value ?? '').trim())
        .filter((c) => c.length > 0);
    }
    return [];
  }

  /** Merge live form serials into API catalog so the modal reflects the grid immediately. */
  private mergeLiveFormSerialsIntoCatalog(
    catalog: InventoryDefinitionDto[]
  ): InventoryDefinitionDto[] {
    return catalog.map((def) => {
      const live = this.liveFormSerialCodesForDefinitionId(def.id);
      if (live.length === 0) {
        return def;
      }
      const merged = new Map<string, string>();
      for (const code of [...(def.serialCodes ?? []), ...live]) {
        const trimmed = code.trim();
        if (trimmed) {
          merged.set(trimmed.toLowerCase(), trimmed);
        }
      }
      return {
        ...def,
        serialCodes: sortNumericCodes([...merged.values()])
      };
    });
  }

  protected onDefaultAccessoryTypeChange(): void {
    const defId = this.defaultAccessoryForm.controls.inventoryDefinitionId.value;
    this.defaultAccessorySelectedDefinitionId.set(
      defId != null && Number.isFinite(defId) ? Number(defId) : null
    );
    const codesCtrl = this.defaultAccessoryForm.controls.accessorySerialCodes;
    codesCtrl.setValue([]);
    this.closeDefaultAccessoryCodesPicker();
    this.syncDefaultAccessoryFormDisabledState();
  }

  protected closeDefaultAccessoryCodesPicker(): void {
    this.defaultAccessoryCodesPickerOpen.set(false);
    this.defaultAccessoryCodeFilter.set('');
  }

  protected toggleDefaultAccessoryCodesPicker(): void {
    if (this.defaultAccessoryForm.controls.accessorySerialCodes.disabled) {
      return;
    }
    const next = !this.defaultAccessoryCodesPickerOpen();
    this.defaultAccessoryCodesPickerOpen.set(next);
    if (next) {
      this.defaultAccessoryCodeFilter.set('');
      queueMicrotask(() => {
        document
          .getElementById('default-acc-codes')
          ?.closest('.default-acc-codes-field')
          ?.scrollIntoView({ block: 'nearest' });
      });
    } else {
      this.defaultAccessoryCodeFilter.set('');
    }
  }

  protected isDefaultAccessoryCodeSelected(code: string): boolean {
    const selected = this.defaultAccessoryForm.controls.accessorySerialCodes.value ?? [];
    const key = code.trim().toLowerCase();
    return selected.some((c) => String(c).trim().toLowerCase() === key);
  }

  protected toggleDefaultAccessoryCode(option: DefaultAccessoryCodeOption, checked: boolean): void {
    if (option.disabled) {
      return;
    }
    const ctrl = this.defaultAccessoryForm.controls.accessorySerialCodes;
    const current = [...(ctrl.value ?? [])];
    const key = option.value.trim().toLowerCase();
    const next = checked
      ? current.some((c) => String(c).trim().toLowerCase() === key)
        ? current
        : [...current, option.value]
      : current.filter((c) => String(c).trim().toLowerCase() !== key);
    ctrl.setValue(next);
    ctrl.markAsTouched();
    ctrl.updateValueAndValidity();
  }

  protected removeDefaultAccessoryCodeChip(code: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    const ctrl = this.defaultAccessoryForm.controls.accessorySerialCodes;
    const key = code.trim().toLowerCase();
    ctrl.setValue((ctrl.value ?? []).filter((c) => String(c).trim().toLowerCase() !== key));
    ctrl.markAsTouched();
    ctrl.updateValueAndValidity();
  }

  protected addDefaultAccessory(): void {
    const parent = this.defaultAccessoriesParentType();
    const parentSerial = this.defaultAccessoriesParentSerial().trim();
    if (!parent || !parentSerial) {
      return;
    }
    if (this.defaultAccessoryForm.invalid) {
      this.defaultAccessoryForm.markAllAsTouched();
      this.toast.error('יש לבחור סוג אביזר ולפחות קוד פריט אחד');
      return;
    }

    const inventoryDefinitionId = this.defaultAccessoryForm.controls.inventoryDefinitionId.value;
    const accessorySerialCodes = (
      this.defaultAccessoryForm.controls.accessorySerialCodes.value ?? []
    )
      .map((c) => String(c).trim())
      .filter((c) => c.length > 0);

    if (inventoryDefinitionId == null || accessorySerialCodes.length === 0) {
      this.toast.error('יש לבחור סוג אביזר ולפחות קוד פריט אחד');
      return;
    }

    const taken = this.defaultAccessoryTakenCodeKeys();
    const blocked = accessorySerialCodes.filter((c) => taken.has(c.toLowerCase()));
    if (blocked.length > 0) {
      this.defaultAccessoryForm.controls.accessorySerialCodes.setErrors({ taken: true });
      this.defaultAccessoryForm.controls.accessorySerialCodes.markAsTouched();
      this.toast.error('לא ניתן לבחור פריט תפוס');
      return;
    }

    this.defaultAccessoriesSaving.set(true);
    this.data
      .createEquipmentDefaultAccessoriesBatch({
        parentEquipmentType: parent,
        parentSerialCode: parentSerial,
        inventoryDefinitionId,
        accessorySerialCodes
      })
      .pipe(finalize(() => this.defaultAccessoriesSaving.set(false)))
      .subscribe({
        next: (created) => {
          if (created === null) {
            return;
          }
          const n = created.length;
          this.toast.success(n === 1 ? 'האביזר הנלווה נוסף' : `${n} אביזרים נלווים נוספו`);
          this.defaultAccessorySelectedDefinitionId.set(null);
          this.defaultAccessoryForm.reset({
            inventoryDefinitionId: null,
            accessorySerialCodes: []
          });
          this.closeDefaultAccessoryCodesPicker();
          this.syncDefaultAccessoryFormDisabledState({ codesEnabled: false });
          this.loadDefaultAccessoriesModalData(parent, parentSerial);
        }
      });
  }

  protected removeDefaultAccessory(row: EquipmentDefaultAccessoryDto): void {
    const parent = this.defaultAccessoriesParentType();
    const parentSerial = this.defaultAccessoriesParentSerial().trim();
    if (!parent || !parentSerial) {
      return;
    }
    this.defaultAccessoriesDeletingId.set(row.id);
    this.data
      .deleteEquipmentDefaultAccessory(row.id)
      .pipe(finalize(() => this.defaultAccessoriesDeletingId.set(null)))
      .subscribe({
        next: (ok) => {
          if (!ok) {
            return;
          }
          this.toast.success('השיוך הוסר');
          this.loadDefaultAccessoriesModalData(parent, parentSerial);
        }
      });
  }

  private ensureSerialSearchSelection(list: InventoryDefinitionDto[]): void {
    const current = this.serialSearchForm.controls.inventoryDefinitionId.value;
    if (current != null && list.some((d) => d.id === current)) {
      this.syncSerialTypeQueryFromSelection();
      return;
    }
    // Do not auto-select a type — search starts empty so type-only / free-text lookup works.
    this.serialSearchForm.patchValue({ inventoryDefinitionId: null }, { emitEvent: false });
  }

  private rebuildCustomInventoryRows(defs: InventoryDefinitionDto[]): void {
    this.editingInventoryRowId.set(null);
    this.inventoryRowSnapshots.clear();
    const rows = this.customInventoryRows();
    while (rows.length > 0) {
      rows.removeAt(0);
    }
    for (const def of defs) {
      const group = this.buildCustomInventoryRow(def);
      rows.push(group);
      this.wireCustomInventoryRowQuantitySync(group);
    }
  }

  protected customInventoryRows(): FormArray {
    return this.customInventoryForm.get('rows') as FormArray;
  }

  protected customInventoryRowGroup(index: number): FormGroup {
    return this.customInventoryRows().at(index) as FormGroup;
  }

  protected customInventoryCodesArray(rowIndex: number): FormArray<FormControl<string>> {
    return this.customInventoryRowGroup(rowIndex).get('codes') as FormArray<FormControl<string>>;
  }

  protected codeIndicesForCustomInventoryRow(rowIndex: number): number[] {
    const len = this.customInventoryCodesArray(rowIndex).length;
    return Array.from({ length: len }, (_, i) => i);
  }

  protected isInventoryRowEditing(defId: number): boolean {
    return this.editingInventoryRowId() === defId;
  }

  protected startEditInventoryRow(def: InventoryDefinitionDto, rowIndex: number): void {
    const currentEdit = this.editingInventoryRowId();
    if (currentEdit != null && currentEdit !== def.id) {
      this.toast.warning('יש לשמור או לבטל את העריכה הנוכחית תחילה');
      return;
    }

    const group = this.customInventoryRowGroup(rowIndex);
    const codes = this.customInventoryCodesArray(rowIndex).controls.map((c) =>
      String(c.value ?? '').trim()
    );
    this.inventoryRowSnapshots.set(def.id, {
      displayName: String(group.get('displayName')?.value ?? ''),
      quantity: this.toNonNegativeInteger(group.get('quantity')?.value),
      codes: [...codes]
    });
    this.setInventoryRowEditable(rowIndex, true);
    this.editingInventoryRowId.set(def.id);
  }

  protected cancelEditInventoryRow(def: InventoryDefinitionDto, rowIndex: number): void {
    const snap = this.inventoryRowSnapshots.get(def.id);
    if (snap) {
      const group = this.customInventoryRowGroup(rowIndex);
      group.patchValue({ displayName: snap.displayName, quantity: snap.quantity }, { emitEvent: false });
      this.setCustomInventoryCodesLength(group, snap.quantity);
      const codesFa = this.customInventoryCodesArray(rowIndex);
      for (let i = 0; i < codesFa.length; i++) {
        codesFa.at(i).setValue(snap.codes[i] ?? '', { emitEvent: false });
      }
    }
    this.setInventoryRowEditable(rowIndex, false);
    this.editingInventoryRowId.set(null);
    this.inventoryRowSnapshots.delete(def.id);
  }

  protected saveInventoryRow(def: InventoryDefinitionDto, rowIndex: number): void {
    const group = this.customInventoryRowGroup(rowIndex);
    const label = String(group.get('displayName')?.value ?? '').trim();
    if (!label) {
      this.toast.error('יש להזין שם פריט');
      return;
    }

    const quantity = this.toNonNegativeInteger(group.get('quantity')?.value);
    const codesFa = this.customInventoryCodesArray(rowIndex);
    const serialCodes: string[] = [];
    for (let c = 0; c < codesFa.length; c++) {
      const raw = String(codesFa.at(c).value ?? '').trim();
      if (raw.length === 0) {
        continue;
      }
      if (raw.length > 100) {
        this.toast.error(`קוד פריט ארוך מדי (#${c + 1})`);
        return;
      }
      if (
        serialCodes.some(
          (existing) => existing.localeCompare(raw, undefined, { sensitivity: 'accent' }) === 0
        )
      ) {
        this.toast.error(`קוד כפול: ${raw}`);
        return;
      }
      serialCodes.push(raw);
    }

    this.savingInventoryRowId.set(def.id);
    this.data
      .updateInventoryDefinitionRow(def.id, {
        displayName: label,
        quantity,
        serialCodes
      })
      .pipe(finalize(() => this.savingInventoryRowId.set(null)))
      .subscribe({
        next: (updated) => {
          if (!updated) {
            return;
          }
          this.toast.success('הפריט נשמר');
          this.inventoryStore.upsert(updated);
          this.customInventoryDefinitions.update((rows) =>
            rows.map((r) => (r.id === updated.id ? updated : r))
          );
          const rows = this.customInventoryRows();
          for (let i = 0; i < rows.length; i++) {
            if (Number((rows.at(i) as FormGroup).get('id')?.value) === updated.id) {
              const rebuilt = this.buildCustomInventoryRow(updated);
              rows.setControl(i, rebuilt);
              this.wireCustomInventoryRowQuantitySync(rebuilt);
              break;
            }
          }
          this.editingInventoryRowId.set(null);
          this.inventoryRowSnapshots.delete(def.id);
          this.loadDefaultAccessoryCounts();
        }
      });
  }

  private setInventoryRowEditable(rowIndex: number, editable: boolean): void {
    const group = this.customInventoryRowGroup(rowIndex);
    const toggle = (ctrl: AbstractControl | null | undefined) => {
      if (!ctrl) {
        return;
      }
      if (editable) {
        ctrl.enable({ emitEvent: false });
      } else {
        ctrl.disable({ emitEvent: false });
      }
    };
    toggle(group.get('displayName'));
    toggle(group.get('quantity'));
    this.customInventoryCodesArray(rowIndex).controls.forEach((c) => toggle(c));
  }

  protected deleteInventoryItem(def: InventoryDefinitionDto, rowIndex: number): void {
    if (!confirm('האם אתה בטוח שברצונך למחוק פריט זה?')) {
      return;
    }

    this.deletingInventoryId.set(def.id);
    this.data
      .deleteInventoryDefinition(def.id)
      .pipe(finalize(() => this.deletingInventoryId.set(null)))
      .subscribe({
        next: (ok) => {
          if (!ok) {
            return;
          }
          // Only mutate local state after the API confirms the soft-delete (204).
          this.removeCustomInventoryRow(def.id, rowIndex);
          this.toast.success(`הפריט "${def.displayName}" נמחק`);
        }
      });
  }

  private removeCustomInventoryRow(id: number, rowIndex: number): void {
    const rows = this.customInventoryRows();
    if (rowIndex >= 0 && rowIndex < rows.length) {
      const atIndex = Number((rows.at(rowIndex) as FormGroup).get('id')?.value);
      if (atIndex === id) {
        rows.removeAt(rowIndex);
      } else {
        const found = rows.controls.findIndex(
          (c) => Number((c as FormGroup).get('id')?.value) === id
        );
        if (found >= 0) {
          rows.removeAt(found);
        }
      }
    } else {
      const found = rows.controls.findIndex(
        (c) => Number((c as FormGroup).get('id')?.value) === id
      );
      if (found >= 0) {
        rows.removeAt(found);
      }
    }

    this.inventoryStore.remove(id);
    this.customInventoryDefinitions.update((defs) => defs.filter((d) => d.id !== id));
    this.ensureSerialSearchSelection(this.inventoryStore.definitions());
  }

  private buildCustomInventoryRow(def: InventoryDefinitionDto): FormGroup {
    const codes = (def.serialCodes ?? []).map((c) => c.trim()).filter((c) => c.length > 0);
    const quantity = Math.max(def.totalQuantity ?? 0, codes.length);
    const codeControls = Array.from({ length: quantity }, (_, i) =>
      this.fb.nonNullable.control(
        { value: codes[i] ?? '', disabled: true },
        [Validators.maxLength(100)]
      )
    );
    const codesFa = this.fb.array<FormControl<string>>(codeControls);
    return this.fb.group({
      id: this.fb.nonNullable.control(def.id),
      displayName: this.fb.nonNullable.control(
        { value: def.displayName, disabled: true },
        [Validators.required, Validators.maxLength(200)]
      ),
      quantity: this.fb.control({ value: quantity, disabled: true }, [Validators.min(0)]),
      codes: codesFa
    });
  }

  private wireCustomInventoryRowQuantitySync(group: FormGroup): void {
    const quantityCtrl = group.get('quantity');
    if (!quantityCtrl) {
      return;
    }
    quantityCtrl.valueChanges
      .pipe(
        map((value) => this.toNonNegativeInteger(value)),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((quantity) => this.setCustomInventoryCodesLength(group, quantity));
  }

  private setCustomInventoryCodesLength(group: FormGroup, target: number): void {
    const length = this.toNonNegativeInteger(target);
    const codes = group.get('codes') as FormArray<FormControl<string>> | null;
    if (!codes) {
      return;
    }

    const editable = group.get('quantity')?.enabled === true;

    while (codes.length < length) {
      const ctrl = this.fb.nonNullable.control('', [Validators.maxLength(100)]);
      if (!editable) {
        ctrl.disable({ emitEvent: false });
      }
      codes.push(ctrl);
    }
    while (codes.length > length) {
      codes.removeAt(codes.length - 1);
    }
  }

  private wireSerialSearchTypeFilter(): void {
    this.serialSearchForm.controls.inventoryDefinitionId.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.serialSearchForm.patchValue({ serialCode: '' }, { emitEvent: false });
        this.serialLocationResult.set(null);
        this.serialLocationIsOneTime.set(false);
        this.typeLocatorResult.set(null);
        this.serialSearchAttempted.set(false);
      });
  }

  private toNonNegativeInteger(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  }

  protected onMaintenanceToggle(row: EquipmentDefinitionDto, event: Event): void {
    const input = event.target as HTMLInputElement;
    const wantOn = input.checked;
    const wasOn = row.isUnderMaintenance === true;
    if (wantOn === wasOn) {
      return;
    }
    this.maintenanceTogglingId.set(row.id);
    this.data
      .patchEquipmentDefinitionMaintenance(row.id, wantOn)
      .pipe(finalize(() => this.maintenanceTogglingId.set(null)))
      .subscribe({
        next: (dto) => {
          if (!dto) {
            input.checked = wasOn;
            return;
          }
          this.store.applyMaintenancePatch(row.id, dto.isUnderMaintenance === true);
          this.maintenanceSync.notifyMaintenanceChanged();
        }
      });
  }

  protected addInventoryCodes(): FormArray<FormControl<string>> {
    return this.addInventoryForm.get('codes') as FormArray<FormControl<string>>;
  }

  protected addInventoryCodeIndices(): number[] {
    const len = this.addInventoryCodes().length;
    return Array.from({ length: len }, (_, i) => i);
  }

  protected showAddInventoryCodes(): boolean {
    return this.toNonNegativeInteger(this.addInventoryForm.controls.quantity.value) > 0;
  }

  protected openAddSlot(): void {
    this.resetAddSlotForm();
    this.addSlotOpen.set(true);
  }

  protected closeAddSlot(): void {
    this.addSlotOpen.set(false);
  }

  protected openAddInventoryItem(): void {
    this.resetAddInventoryForm();
    this.addInventoryOpen.set(true);
  }

  protected closeAddInventoryItem(): void {
    this.addInventoryOpen.set(false);
  }

  protected autoFillInventoryCodes(): void {
    const codes = this.addInventoryCodes();
    if (codes.length === 0) {
      return;
    }

    let next = 1;
    const used = new Set(
      codes.controls
        .map((c) => String(c.value ?? '').trim())
        .filter((c) => c.length > 0)
        .map((c) => c.toLowerCase())
    );

    for (let i = 0; i < codes.length; i++) {
      const current = String(codes.at(i).value ?? '').trim();
      if (current.length > 0) {
        continue;
      }
      while (used.has(String(next))) {
        next++;
      }
      const fallback = String(next);
      used.add(fallback);
      codes.at(i).setValue(fallback);
      next++;
    }
  }

  protected focusNextAddInventoryCode(event: Event): void {
    this.focusNextCodeInput(event, 'input.add-inventory-code-input[data-serial-nav="inv"]');
  }

  private focusNextCodeInput(event: Event, selector: string): void {
    event.preventDefault();
    event.stopPropagation();

    const current = event.target;
    if (!(current instanceof HTMLInputElement)) {
      return;
    }

    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>(selector));
    const index = inputs.indexOf(current);
    if (index < 0 || index >= inputs.length - 1) {
      return;
    }

    const next = inputs[index + 1];
    next.focus();
    next.select();
  }

  protected submitAddSlot(): void {
    if (this.addSlotForm.invalid) {
      this.addSlotForm.markAllAsTouched();
      this.toast.error('אנא תקנו את השדות המסומנים');
      return;
    }

    const displayName = (this.addSlotForm.controls.displayName.value ?? '').trim();
    const code = (this.addSlotForm.controls.code.value ?? '').trim();

    this.saving.set(true);
    this.data
      .createEquipmentDefinitionsBatch({
        displayName,
        category: 'Speakers',
        itemCodes: [code]
      })
      .pipe(finalize(() => this.saving.set(false)))
      .subscribe({
        next: (created) => {
          if (created === null) {
            return;
          }
          this.toast.success('הרמקול נוסף בהצלחה');
          this.store.upsertDefinitions(created);
          this.closeAddSlot();
          this.resetAddSlotForm();
        }
      });
  }

  protected submitAddInventoryItem(): void {
    if (this.addInventoryForm.invalid) {
      this.addInventoryForm.markAllAsTouched();
      this.toast.error('אנא תקנו את השדות המסומנים');
      return;
    }

    const displayName = (this.addInventoryForm.controls.displayName.value ?? '').trim();
    if (!displayName) {
      this.addInventoryForm.controls.displayName.markAsTouched();
      this.toast.error('יש להזין שם פריט');
      return;
    }

    const quantity = this.toNonNegativeInteger(this.addInventoryForm.controls.quantity.value);
    const rawCodes =
      quantity > 0
        ? this.addInventoryCodes()
            .controls.map((c) => String(c.value ?? '').trim())
            .filter((c) => c.length > 0)
        : [];

    const unique = new Set(rawCodes.map((c) => c.toLowerCase()));
    if (unique.size !== rawCodes.length) {
      this.toast.error('קיימים קודי פריט כפולים בטופס');
      return;
    }

    this.inventorySaving.set(true);
    this.data
      .createInventoryDefinition({
        displayName,
        quantity,
        // Only send filled codes — blanks are not auto-generated for custom items.
        serialCodes: rawCodes
      })
      .pipe(finalize(() => this.inventorySaving.set(false)))
      .subscribe({
        next: (created) => {
          if (created === null) {
            return;
          }
          this.toast.success(`הפריט "${created.displayName}" נוסף למלאי`);
          this.closeAddInventoryItem();
          this.resetAddInventoryForm();
          this.loadAccessoryInventory();
        }
      });
  }

  private wireAddInventoryQuantitySync(): void {
    this.addInventoryForm.controls.quantity.valueChanges
      .pipe(
        startWith(this.addInventoryForm.controls.quantity.value),
        map((v) => this.toNonNegativeInteger(v)),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((qty) => this.setAddInventoryCodesLength(qty));
  }

  private setAddInventoryCodesLength(target: number): void {
    const length = Math.min(200, Math.max(0, target));
    const codes = this.addInventoryCodes();
    while (codes.length < length) {
      // Optional serial codes — blank allowed; server generates sequential fallbacks.
      codes.push(this.fb.nonNullable.control('', [Validators.maxLength(100)]));
    }
    while (codes.length > length) {
      codes.removeAt(codes.length - 1);
    }
  }

  private resetAddSlotForm(): void {
    this.addSlotForm.reset({
      displayName: '',
      code: ''
    });
  }

  private resetAddInventoryForm(): void {
    this.addInventoryForm.reset({
      displayName: '',
      quantity: 0
    });
    this.setAddInventoryCodesLength(0);
  }

  protected rows(): EquipmentDefinitionDto[] {
    return this.store.definitions();
  }

  protected openEdit(row: EquipmentDefinitionDto): void {
    this.editingId.set(row.id);
    this.editForm.reset({
      displayName: row.displayName,
      sortOrder: row.sortOrder
    });
    this.editOpen.set(true);
  }

  protected closeEdit(): void {
    this.editOpen.set(false);
    this.editingId.set(null);
  }

  protected saveEdit(): void {
    const id = this.editingId();
    if (!id) {
      return;
    }
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      this.toast.error('אנא תקנו את השדות המסומנים');
      return;
    }

    const v = this.editForm.getRawValue();
    const sortOrder = Number(v.sortOrder);
    if (!Number.isFinite(sortOrder)) {
      this.toast.error('סדר חייב להיות מספר שלם');
      return;
    }

    this.editSaving.set(true);
    this.data
      .updateEquipmentDefinition(id, {
        displayName: (v.displayName ?? '').trim(),
        sortOrder: Math.trunc(sortOrder)
      })
      .pipe(finalize(() => this.editSaving.set(false)))
      .subscribe({
        next: (updated) => {
          if (updated === null) {
            return;
          }
          this.toast.success('התא עודכן');
          this.store.upsertDefinition(updated);
          this.closeEdit();
        }
      });
  }

  protected deleteRow(row: EquipmentDefinitionDto): void {
    if (
      !confirm(
        'שימי לב: מחיקת התא תמחק לצמיתות את כל היסטוריית ההזמנות הישנות המשויכות אליו. האם להמשיך?'
      )
    ) {
      return;
    }
    this.deletingId.set(row.id);
    this.data.deleteEquipmentDefinition(row.id).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.toast.success('התא נמחק');
        this.store.removeDefinition(row.id);
      },
      error: (err: unknown) => {
        this.deletingId.set(null);
        const blocked = this.parseFutureOrdersBlock(err);
        if (blocked) {
          this.futureOrdersModal.set(blocked);
          return;
        }
        this.toast.error(this.deleteEquipmentErrorMessage(err));
      }
    });
  }

  protected closeFutureOrdersModal(): void {
    this.futureOrdersModal.set(null);
  }

  protected openOrderEditInNewTab(orderId: number): void {
    const returnUrl = '/admin/equipment-slots';
    const q = new URLSearchParams({ returnUrl });
    const url = `${window.location.origin}/orders/${orderId}?${q.toString()}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  protected formatBlockingOrderDate(orderDate: string): string {
    const s = orderDate.trim();
    const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00`) : new Date(s);
    if (Number.isNaN(d.getTime())) {
      return orderDate;
    }
    return d.toLocaleDateString('he-IL', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  private parseFutureOrdersBlock(err: unknown): EquipmentDefinitionDeleteFutureOrder[] | null {
    if (!(err instanceof HttpErrorResponse) || err.status !== 400) {
      return null;
    }
    const body = err.error;
    if (!body || typeof body !== 'object') {
      return null;
    }
    const raw = (body as { futureOrders?: unknown }).futureOrders;
    if (!Array.isArray(raw) || raw.length === 0) {
      return null;
    }
    const out: EquipmentDefinitionDeleteFutureOrder[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const r = item as Record<string, unknown>;
      const orderId = Number(r['orderId']);
      if (!Number.isFinite(orderId)) {
        continue;
      }
      const cn = r['customerName'];
      const customerName =
        cn === null || cn === undefined
          ? null
          : typeof cn === 'string'
            ? cn
            : String(cn);
      let orderDate = '';
      const od = r['orderDate'];
      if (typeof od === 'string') {
        orderDate = od;
      } else if (od && typeof od === 'object' && 'year' in od) {
        const y = (od as { year?: unknown }).year;
        const m = (od as { month?: unknown }).month;
        const day = (od as { day?: unknown }).day;
        if (typeof y === 'number' && typeof m === 'number' && typeof day === 'number') {
          orderDate = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }
      if (!orderDate) {
        continue;
      }
      out.push({ orderId, customerName, orderDate });
    }
    const todayYmd = this.todayIsraelYmd();
    const futureOnly = out
      .map((o) => {
        const ymd = this.normalizeOrderDateYmd(o.orderDate);
        return ymd ? { ...o, orderDate: ymd } : null;
      })
      .filter(
        (o): o is EquipmentDefinitionDeleteFutureOrder =>
          o !== null && o.orderDate >= todayYmd
      )
      .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.orderId - b.orderId);
    return futureOnly.length > 0 ? futureOnly : null;
  }

  /** Same calendar day rule as the API (Asia/Jerusalem), YYYY-MM-DD for string compare. */
  private todayIsraelYmd(): string {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jerusalem' });
  }

  private normalizeOrderDateYmd(raw: string): string | null {
    const s = raw.trim();
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
    return m ? m[1] : null;
  }

  private deleteEquipmentErrorMessage(err: unknown): string {
    const fallback = 'שגיאה במחיקה';
    if (!(err instanceof HttpErrorResponse)) {
      return fallback;
    }
    const body = err.error;
    if (body && typeof body === 'object' && 'message' in body) {
      const m = (body as { message: unknown }).message;
      if (typeof m === 'string' && m.trim().length > 0) {
        return m.trim();
      }
    }
    if (typeof body === 'string' && body.trim().length > 0) {
      return body.trim();
    }
    if (err.status === 400) {
      return 'לא ניתן למחוק את התא';
    }
    return fallback;
  }
}
