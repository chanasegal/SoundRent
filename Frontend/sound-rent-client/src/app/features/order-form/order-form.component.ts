import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, afterNextRender, computed, DestroyRef, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, EMPTY, finalize, map, of, startWith, switchMap, tap } from 'rxjs';

import {
  DEPOSIT_TYPE_LABELS,
  DepositType,
  LOANED_EQUIPMENT_LABELS,
  LOANED_EQUIPMENT_ORDER,
  LoanedEquipmentType,
  RETURN_TIME_TYPE_LABELS,
  ReturnTimeType,
  TIME_SLOT_LABELS,
  TimeSlot
} from '../../core/models/enums';
import { normalizeOrderEquipmentQueryParam } from '../../core/models/booking-slots';
import { CustomerDto } from '../../core/models/customer.model';
import { LoanedEquipmentNoteDto, OrderCreateUpdateDto, OrderLoanedEquipmentDto, OrderShiftDto } from '../../core/models/order.model';
import { DataService } from '../../core/services/data.service';
import { EquipmentDefinitionsStore } from '../../core/services/equipment-definitions.store';
import { EquipmentMaintenanceSyncService } from '../../core/services/equipment-maintenance-sync.service';
import { HebrewDateService, HebrewMonthOption } from '../../core/services/hebrew-date.service';
import { ToastService } from '../../core/services/toast.service';
import { IntegerOnlyDirective } from '../../shared/directives/integer-only.directive';

interface LoanedRowMeta {
  type: LoanedEquipmentType;
  label: string;
}

@Component({
  selector: 'app-order-form',
  imports: [CommonModule, ReactiveFormsModule, RouterLink, IntegerOnlyDirective],
  templateUrl: './order-form.component.html',
  styleUrl: './order-form.component.scss'
})
export class OrderFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly data = inject(DataService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly hebrew = inject(HebrewDateService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly equipmentSlots = inject(EquipmentDefinitionsStore);
  private readonly maintenanceSync = inject(EquipmentMaintenanceSyncService);

  protected readonly bookingEquipmentSlotIds = computed(() =>
    this.equipmentSlots
      .definitions()
      .filter((d) => d.category === 'Speakers' && d.isUnderMaintenance !== true)
      .map((d) => d.id)
  );

  protected readonly timeSlots: TimeSlot[] = [TimeSlot.Morning, TimeSlot.Evening];
  protected readonly timeSlotLabels = TIME_SLOT_LABELS;

  /** Shifts allowed for a Gregorian date (Friday → morning only, Saturday → evening only). */
  protected availableTimeSlots(iso = this.form.controls['startDate']?.value as string): TimeSlot[] {
    const d = typeof iso === 'string' ? this.hebrew.parseIso(iso) : null;
    if (!d) {
      return this.timeSlots;
    }
    const dow = d.getDay();
    if (dow === 5) {
      return [TimeSlot.Morning];
    }
    if (dow === 6) {
      return [TimeSlot.Evening];
    }
    return this.timeSlots;
  }

  /** Used in the template: invalid shift options stay visible but disabled (no helper text). */
  protected isStartShiftSelectable(slot: TimeSlot): boolean {
    return this.availableTimeSlots(this.form.controls['startDate'].value as string).includes(slot);
  }

  protected isEndShiftSelectable(slot: TimeSlot): boolean {
    return this.availableTimeSlots(this.form.controls['endDate'].value as string).includes(slot);
  }

  protected slotDropdownLabel(slot: string): string {
    return this.equipmentSlots.displayLabel(slot);
  }

  protected isEquipmentSelected(slot: string): boolean {
    return this.selectedEquipmentIdsControl.value.includes(slot);
  }

  protected readonly equipmentDropdownOpen = signal(false);

  protected toggleEquipmentDropdown(): void {
    this.equipmentDropdownOpen.update((open) => !open);
  }

  protected selectedEquipmentSummary(): string {
    const selected = this.selectedEquipmentIdsControl.value ?? [];
    if (selected.length === 0) {
      return 'בחרו תאי ציוד';
    }
    if (selected.length <= 2) {
      return selected.map((id) => this.slotDropdownLabel(id)).join(', ');
    }
    return `${selected.length} תאי ציוד נבחרו`;
  }

  protected toggleEquipmentSelection(slot: string, checked: boolean): void {
    const current = this.selectedEquipmentIdsControl.value ?? [];
    const next = checked
      ? [...current, slot]
      : current.filter((id) => id !== slot);
    this.selectedEquipmentIdsControl.setValue([...new Set(next)]);
    this.selectedEquipmentIdsControl.markAsTouched();
    this.slotCheckTrigger$.next();
  }

  protected selectedShiftRows(): OrderShiftDto[] {
    return (this.selectedShiftSlots.getRawValue() as OrderShiftDto[])
      .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || Number(a.timeSlot) - Number(b.timeSlot));
  }

  protected formatSelectedShiftDate(iso: string): string {
    const d = this.hebrew.parseIso(iso);
    return d ? this.hebrew.formatGregorianWithDayName(d) : iso;
  }

  protected rangeSummary(): string {
    const rows = this.selectedShiftRows();
    return rows.length === 0 ? 'לא נוצרו מועדים' : `${rows.length} משמרות רצופות`;
  }

  protected readonly depositTypes: DepositType[] = [
    DepositType.Check,
    DepositType.CreditCard,
    DepositType.Cash
  ];
  protected readonly depositTypeLabels = DEPOSIT_TYPE_LABELS;
  protected readonly returnTimeTypes: ReturnTimeType[] = [
    ReturnTimeType.SpecificTime,
    ReturnTimeType.LateNight,
    ReturnTimeType.NextMorning
  ];
  protected readonly returnTimeTypeLabels = RETURN_TIME_TYPE_LABELS;
  protected readonly returnTimeTypeEnum = ReturnTimeType;

  protected readonly editingId = signal<number | null>(null);
  protected readonly orderCancelled = signal(false);
  protected readonly isEdit = computed(() => this.editingId() !== null);
  protected readonly title = computed(() => (this.isEdit() ? 'עריכת הזמנה' : 'הזמנה חדשה'));
  protected readonly submitting = signal(false);

  /** One row per loaned equipment type (labels + dynamic פירוט). */
  protected readonly rowDefinitions: LoanedRowMeta[] = LOANED_EQUIPMENT_ORDER.map((type) => ({
    type,
    label: LOANED_EQUIPMENT_LABELS[type]
  }));

  protected readonly form = this.buildForm();

  constructor() {
    afterNextRender(() => this.resetScrollForOrderForm());

    effect(() => {
      const v = this.maintenanceSync.version();
      if (v === 0) {
        return;
      }
      untracked(() => {
        this.equipmentSlots.load().subscribe();
      });
    });

    effect(() => {
      const ids = new Set(this.bookingEquipmentSlotIds());
      const current = this.selectedEquipmentIdsControl.value ?? [];
      const next = current.filter((id) => ids.has(id));
      if (next.length !== current.length) {
        untracked(() => this.selectedEquipmentIdsControl.setValue(next, { emitEvent: true }));
      }
    });
  }

  // -----------------------------------------------------------------
  // Hebrew-date driven inputs (the "master" fields).
  // The numeric Hebrew Year / Month / Day controls live in the form;
  // the Gregorian `orderDate` is derived from them and kept in sync.
  // -----------------------------------------------------------------


  protected readonly slotTakenSig = signal(false);

  /** Offer one-click fill when a saved customer matches the typed Phone1 (or Phone2). */
  protected readonly existingCustomerMatch = signal<CustomerDto | null>(null);

  /** Digits-only snapshot of Phone1 for template visibility (updated on every keystroke). */
  private readonly phone1DigitsSig = signal('');

  /** Customer fill CTA: new orders only, Phone1 non-empty, match found, not yet applied from this offer. */
  protected readonly showCustomerFillButton = computed((): CustomerDto | null => {
    if (this.isEdit()) {
      return null;
    }
    if (this.phone1DigitsSig().length === 0) {
      return null;
    }
    return this.existingCustomerMatch();
  });

  /** Pulse triggered every time we want to re-evaluate `slotTakenSig`. */
  private readonly slotCheckTrigger$ = new Subject<void>();

  private readonly startHebrewYearSig = signal<number>(0);
  private readonly startHebrewMonthSig = signal<number>(0);
  private readonly endHebrewYearSig = signal<number>(0);
  private readonly endHebrewMonthSig = signal<number>(0);
  private readonly extraYearsSig = signal<number[]>([]);

  protected readonly startYearOptions = computed(() => this.yearOptionsForEndpoint('start'));
  protected readonly endYearOptions = computed(() => this.yearOptionsForEndpoint('end'));
  protected readonly startMonthOptions = computed(() => this.monthOptionsForEndpoint('start'));
  protected readonly endMonthOptions = computed(() => this.monthOptionsForEndpoint('end'));
  protected readonly startDayOptions = computed(() => this.dayOptionsForEndpoint('start'));
  protected readonly endDayOptions = computed(() => this.dayOptionsForEndpoint('end'));

  // Convenience accessors for the template.
  protected get equipmentList(): FormArray {
    return this.form.get('loanedEquipments') as FormArray;
  }

  protected get selectedEquipmentIdsControl(): FormControl<string[]> {
    return this.form.get('equipmentDefinitionIds') as FormControl<string[]>;
  }

  protected get selectedShiftSlots(): FormArray {
    return this.form.get('shifts') as FormArray;
  }

  protected getRowGroup(index: number): FormGroup {
    return this.equipmentList.at(index) as FormGroup;
  }

  protected noteIndicesForRow(rowIndex: number): number[] {
    const row = this.equipmentList?.at(rowIndex) as FormGroup | undefined;
    const notes = row?.get('notes') as FormArray | undefined;
    const len = notes?.length ?? 0;
    return Array.from({ length: len }, (_, i) => i);
  }

  protected getNoteControl(rowIndex: number, noteIndex: number): FormControl<string> {
    const notes = this.getRowGroup(rowIndex).get('notes') as FormArray<FormControl<string>>;
    return notes.at(noteIndex) as FormControl<string>;
  }

  protected isMicrophoneRow(rowIndex: number): boolean {
    return this.getRowGroup(rowIndex).get('loanedEquipmentType')?.value === LoanedEquipmentType.Microphone;
  }

  /** Gematriya label for a Hebrew day (e.g. 23 → "כ״ג"). */
  protected dayLabel(day: number): string {
    return this.hebrew.dayGematriya(day);
  }

  /** Gematriya label for a Hebrew year (e.g. 5786 → "תשפ״ו"). */
  protected yearLabel(year: number): string {
    return this.hebrew.yearGematriya(year);
  }

  /** Window scroll (layout has no inner scroll container). Clears stray focus from inputs to avoid scroll-into-view jumps. */
  private resetScrollForOrderForm(): void {
    const d = this.document;
    const win = d.defaultView;
    if (!win) {
      return;
    }
    win.scrollTo(0, 0);
    d.documentElement.scrollTop = 0;
    (d.body as HTMLElement).scrollTop = 0;
    const el = d.activeElement;
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLButtonElement
    ) {
      el.blur();
    }
  }

  ngOnInit(): void {
    queueMicrotask(() => this.resetScrollForOrderForm());

    this.wireSlotAvailabilityCheck();
    this.wireHebrewRangeSync();
    this.wireRangeSync();
    this.wireCustomerPhoneLookup();
    this.wireLoanedEquipmentQuantitySync();

    const idParam = this.route.snapshot.paramMap.get('id');
    if (idParam && /^\d+$/.test(idParam)) {
      const id = Number(idParam);
      this.editingId.set(id);
      this.loadOrder(id);
      return;
    }

    this.applyCreateModeFromQueryParams();
  }

  /**
   * Pre-fill from `/orders/new?...` when catalog is available (loaded via APP_INITIALIZER).
   */
  private applyCreateModeFromQueryParams(): void {
    const qp = this.route.snapshot.queryParamMap;
    if (
      !qp.has('equipment') &&
      !qp.has('date') &&
      !qp.has('slot') &&
      !qp.has('customerName') &&
      !qp.has('phone') &&
      !qp.has('notes')
    ) {
      return;
    }

    const eq = normalizeOrderEquipmentQueryParam(qp.get('equipment'), (id: string) => this.equipmentSlots.hasSpeakerSlot(id));
    const date = qp.get('date');
    const slotRaw = qp.get('slot');
    const customerName = qp.get('customerName');
    const phone = qp.get('phone');
    const notes = qp.get('notes');

    const patch: Record<string, unknown> = {};
    if (eq) {
      patch['equipmentDefinitionIds'] = [eq];
    }
    if (slotRaw !== null && slotRaw !== '') {
      const slot = this.parseTimeSlotQueryParam(slotRaw);
      if (slot !== null) {
        patch['startShift'] = slot;
        patch['endShift'] = slot;
      }
    }
    if (customerName) {
      patch['customerName'] = customerName;
    }
    if (phone) {
      patch['phone'] = phone;
    }
    if (notes) {
      patch['notes'] = notes;
    }
    if (Object.keys(patch).length > 0) {
      this.form.patchValue(patch as never, { emitEvent: false });
    }

    if (date) {
      this.setHebrewFromIso(date, 'start');
      this.setHebrewFromIso(date, 'end');
    }

    this.syncShiftsFromRange();
  }

  private parseTimeSlotQueryParam(raw: string): TimeSlot | null {
    const value = raw.trim();
    if (value === TimeSlot.Morning || value === '1') {
      return TimeSlot.Morning;
    }
    if (value === TimeSlot.Evening || value === '2') {
      return TimeSlot.Evening;
    }
    return null;
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.toast.error(this.firstInvalidMessage());
      return;
    }

    this.sendSave();
  }

  protected applyExistingCustomerFill(): void {
    const c = this.existingCustomerMatch();
    if (!c) {
      return;
    }
    const directoryNotes = c.notes ?? '';
    this.form.patchValue(
      {
        customerName: c.fullName ?? '',
        address: c.address ?? ''
      },
      { emitEvent: true }
    );
    this.existingCustomerMatch.set(null);
    if (directoryNotes.trim().length > 0) {
      this.showCustomerDirectoryNotesAlert(directoryNotes);
    }
    this.toast.show('שם וכתובת עודכנו מהכרטיס לקוח', 'info');
  }

  /** Toast from customer card notes after "fill details"; stronger styling for payment-risk phrases. */
  private showCustomerDirectoryNotesAlert(notes: string): void {
    const trimmed = notes.trim();
    if (!trimmed) {
      return;
    }
    const display = trimmed.length > 600 ? `${trimmed.slice(0, 600)}…` : trimmed;
    const critical = trimmed.includes('חוב') || trimmed.includes('לא משלם');
    const message = `הערות בכרטיס הלקוח:\n${display}`;
    if (critical) {
      this.toast.show(message, 'error', 25_000);
    } else {
      this.toast.warning(message, 16_000);
    }
  }

  /**
   * Picks the most relevant validation message for the toast banner so the
   * user immediately understands what blocked the save.
   */
  private firstInvalidMessage(): string {
    if (this.form.errors?.['orderDateInPast']) {
      return 'לא ניתן לשמור הזמנה לתאריך שעבר';
    }
    if (this.form.errors?.['shiftsRequired']) {
      return 'יש להוסיף לפחות תאריך ומשמרת אחת להזמנה';
    }
    if (this.form.errors?.['rangeInvalid']) {
      return 'מועד הסיום חייב להיות אחרי מועד ההתחלה';
    }
    if (this.form.errors?.['selectedShiftInPast']) {
      return 'לא ניתן לשמור הזמנה עם משמרת מתאריך שעבר';
    }
    if (this.form.errors?.['shiftNotAllowedForDate']) {
      return 'המשמרת אינה מתאימה ליום הנבחר (שישי — בוקר, שבת — ערב)';
    }
    if (this.selectedEquipmentIdsControl.errors?.['required']) {
      return 'יש לבחור לפחות תא ציוד אחד';
    }
    if (this.form.errors?.['returnTimeRequired']) {
      return 'יש להזין שעת החזרה';
    }
    const phoneCtrl = this.form.controls['phone'];
    const phone2Ctrl = this.form.controls['phone2'];
    if (phoneCtrl.errors?.['phoneLength'] || phone2Ctrl.errors?.['phoneLength']) {
      return 'מספר טלפון חייב להיות 9 או 10 ספרות';
    }
    return 'אנא מלאו את כל השדות הנדרשים';
  }

  /** After save/delete (or failed load): optional in-app return from `returnUrl` query param. */
  private navigateAfterOrderFlow(orderDateIso?: string | null): void {
    const url = this.safeReturnUrlFromRoute();
    const dashQuery = this.dashboardDateQueryParams(orderDateIso);
    if (url !== null) {
      if (url === '/dashboard') {
        void this.router.navigate(['/dashboard'], { queryParams: dashQuery });
        return;
      }
      void this.router.navigateByUrl(url);
      return;
    }
    void this.router.navigate(['/dashboard'], { queryParams: dashQuery });
  }

  /** `date` is only added when it is a valid `yyyy-MM-dd` (Gregorian order date). */
  private dashboardDateQueryParams(orderDateIso: string | null | undefined): { date?: string } {
    if (!orderDateIso || typeof orderDateIso !== 'string') {
      return {};
    }
    const t = orderDateIso.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? { date: t } : {};
  }

  /**
   * Accepts only same-origin relative paths (no scheme, no //), to avoid open redirects.
   */
  private safeReturnUrlFromRoute(): string | null {
    const raw = this.route.snapshot.queryParamMap.get('returnUrl');
    if (!raw || typeof raw !== 'string') {
      return null;
    }
    const trimmed = raw.trim();
    if (!trimmed.startsWith('/') || trimmed.startsWith('//')) {
      return null;
    }
    if (trimmed.includes(':') || trimmed.includes('\\')) {
      return null;
    }
    if (!/^\/[a-zA-Z0-9/_-]*$/.test(trimmed)) {
      return null;
    }
    return trimmed;
  }

  private sendSave(): void {
    const payload = this.toPayload();
    this.submitting.set(true);

    const id = this.editingId();
    const obs$ = id !== null
      ? this.data.updateOrder(id, payload)
      : this.data.createOrder(payload);

    obs$
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (saved) => {
          if (saved === null) {
            return;
          }
          this.existingCustomerMatch.set(null);
          this.toast.success(id !== null ? 'ההזמנה עודכנה בהצלחה' : 'ההזמנה נשמרה בהצלחה');
          this.navigateAfterOrderFlow(saved.shifts?.[0]?.orderDate);
        }
      });
  }

  protected clearForm(): void {
    const todayIso = this.toIso(new Date());
    const todayParts = this.hebrew.toHebrewParts(new Date());
    this.form.reset({
      equipmentDefinitionIds: this.selectedEquipmentIdsControl.value,
      startDate: todayIso,
      startShift: TimeSlot.Morning,
      endDate: todayIso,
      endShift: TimeSlot.Morning,
      orderDate: todayIso,
      startHebrewYear: todayParts.year,
      startHebrewMonth: todayParts.month,
      startHebrewDay: todayParts.day,
      endHebrewYear: todayParts.year,
      endHebrewMonth: todayParts.month,
      endHebrewDay: todayParts.day,
      customerName: '',
      phone: '',
      phone2: '',
      address: '',
      depositType: null,
      depositOnName: '',
      paymentAmount: null,
      isPaid: true,
      returnTimeType: ReturnTimeType.LateNight,
      customReturnTime: '',
      notes: ''
    });
    this.startHebrewYearSig.set(todayParts.year);
    this.startHebrewMonthSig.set(todayParts.month);
    this.endHebrewYearSig.set(todayParts.year);
    this.endHebrewMonthSig.set(todayParts.month);
    this.syncHebrewEndpointToIso('start', false);
    this.syncHebrewEndpointToIso('end', false);
    this.selectedShiftSlots.clear();
    this.syncShiftsFromRange();
    this.equipmentList.controls.forEach((row, idx) => {
      const type = LOANED_EQUIPMENT_ORDER[idx]!;
      const g = row as FormGroup;
      g.patchValue({ quantity: 0, expectedNoteCount: 0 }, { emitEvent: false });
      this.setNotesArrayLength(g, 0);
      const notes = g.get('notes') as FormArray;
      for (let i = 0; i < notes.length; i++) {
        notes.at(i).setValue('');
      }
    });
    this.existingCustomerMatch.set(null);
    this.syncShiftsFromRange();
    this.toast.show('הטופס נוקה', 'info');
  }

  protected delete(): void {
    const id = this.editingId();
    if (id === null) return;
    if (!confirm('למחוק את ההזמנה? לא ניתן לשחזר פעולה זו.')) return;

    this.submitting.set(true);
    this.data
      .deleteOrder(id)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (ok) => {
          if (!ok) {
            return;
          }
          this.toast.success('ההזמנה נמחקה בהצלחה');
          const iso = this.form.controls['startDate'].value;
          this.navigateAfterOrderFlow(typeof iso === 'string' ? iso : null);
        }
      });
  }

  protected cancel(): void {
    const id = this.editingId();
    if (id === null || this.orderCancelled()) {
      return;
    }
    if (!confirm('לבטל את ההזמנה? המשבצות בלוח השבועי יתפנו מיד.')) {
      return;
    }

    this.submitting.set(true);
    this.data
      .cancelOrder(id)
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (order) => {
          if (order === null) {
            return;
          }
          this.toast.success('ההזמנה בוטלה בהצלחה');
          const iso = this.form.controls['startDate'].value;
          this.navigateAfterOrderFlow(typeof iso === 'string' ? iso : null);
        }
      });
  }

  // -----------------------------------------------------------------
  // Form construction
  // -----------------------------------------------------------------

  private buildForm(): FormGroup {
    const today = new Date();
    const todayIso = this.toIso(today);
    const parts = this.hebrew.toHebrewParts(today);

    return this.fb.group(
      {
        equipmentDefinitionIds: this.fb.nonNullable.control<string[]>([], Validators.required),
        startDate: this.fb.nonNullable.control<string>(todayIso, Validators.required),
        startShift: this.fb.nonNullable.control<TimeSlot>(TimeSlot.Morning, Validators.required),
        endDate: this.fb.nonNullable.control<string>(todayIso, Validators.required),
        endShift: this.fb.nonNullable.control<TimeSlot>(TimeSlot.Morning, Validators.required),
        orderDate: this.fb.nonNullable.control<string>(todayIso, Validators.required),
        shifts: this.fb.array([]),

        startHebrewYear: this.fb.nonNullable.control<number>(parts.year, Validators.required),
        startHebrewMonth: this.fb.nonNullable.control<number>(parts.month, Validators.required),
        startHebrewDay: this.fb.nonNullable.control<number>(parts.day, Validators.required),
        endHebrewYear: this.fb.nonNullable.control<number>(parts.year, Validators.required),
        endHebrewMonth: this.fb.nonNullable.control<number>(parts.month, Validators.required),
        endHebrewDay: this.fb.nonNullable.control<number>(parts.day, Validators.required),

        customerName: ['', Validators.maxLength(100)],
        phone: ['', [Validators.required, Validators.maxLength(20), OrderFormComponent.phoneLengthValidator]],
        phone2: ['', [Validators.maxLength(20), OrderFormComponent.phoneLengthValidator]],
        address: ['', Validators.maxLength(200)],
        depositType: [null as DepositType | null],
        depositOnName: ['', Validators.maxLength(100)],
        paymentAmount: [null as number | null, [Validators.min(0)]],
        isPaid: [true],
        returnTimeType: this.fb.nonNullable.control<ReturnTimeType>(ReturnTimeType.LateNight, Validators.required),
        customReturnTime: ['', Validators.maxLength(20)],
        notes: ['', Validators.maxLength(1000)],

        loanedEquipments: this.fb.array(
          LOANED_EQUIPMENT_ORDER.map((type) => this.buildEquipmentRow(type))
        )
      },
      {
        // Wrap in an arrow at the call site so `this` is bound when Angular
        // invokes the validator. The validator itself must be a *method*
        // (not an instance-field arrow) because `buildForm()` runs during
        // field initialization — before any later instance-field arrow
        // properties have been assigned — so referencing one of those would
        // pass `undefined` to Angular and crash with
        // "Cannot read properties of undefined (reading 'validate')".
        validators: [
          (group: AbstractControl) => this.orderDateNotInPastValidator(group),
          (group: AbstractControl) => this.rangeOrderValidator(group),
          (group: AbstractControl) => this.shiftsRequiredValidator(group),
          (group: AbstractControl) => this.selectedShiftsNotInPastValidator(group),
          (group: AbstractControl) => this.selectedShiftsAllowedValidator(group),
          (group: AbstractControl) => this.returnTimeValidator(group)
        ]
      }
    );
  }

  // -----------------------------------------------------------------
  // Validators
  // -----------------------------------------------------------------

  /**
   * A phone number, when provided, must contain exactly 9 or 10 digits.
   * Empty values pass — the "required" check is handled separately by
   * `Validators.required` on the `phone` control only.
   */
  private static phoneLengthValidator(control: AbstractControl): ValidationErrors | null {
    const raw = control.value;
    if (raw === null || raw === undefined) return null;
    const value = String(raw).trim();
    if (value.length === 0) return null;
    return /^\d{9,10}$/.test(value) ? null : { phoneLength: true };
  }

  private static digitsOnly(raw: string): string {
    return raw.replace(/\D/g, '');
  }

  /**
   * Form-level validator that prevents saving an order for a date that has
   * already passed. Comparison is done against today's local Gregorian date,
   * using the auto-synced `orderDate` ISO value (which mirrors the Hebrew
   * Day / Month / Year dropdowns).
   *
   * NOTE: This is intentionally a regular (prototype) method, not an
   * instance-field arrow, so it is callable from `buildForm()` during the
   * `form = this.buildForm()` field initializer.
   */
  private orderDateNotInPastValidator(group: AbstractControl): ValidationErrors | null {
    if (this.editingId() !== null) {
      return null;
    }
    const dates = [group.get('startDate')?.value, group.get('endDate')?.value]
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
    if (dates.length === 0) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (const iso of dates) {
      const selected = this.hebrew.parseIso(iso);
      if (!selected) continue;
      selected.setHours(0, 0, 0, 0);
      if (selected.getTime() < today.getTime()) {
        return { orderDateInPast: true };
      }
    }

    return null;
  }

  private rangeOrderValidator(group: AbstractControl): ValidationErrors | null {
    const startDate = group.get('startDate')?.value as string | undefined;
    const endDate = group.get('endDate')?.value as string | undefined;
    const startShift = group.get('startShift')?.value as TimeSlot | undefined;
    const endShift = group.get('endShift')?.value as TimeSlot | undefined;
    if (!startDate || !endDate || startShift == null || endShift == null) {
      return null;
    }
    return this.compareShiftEndpoints(startDate, startShift, endDate, endShift) <= 0
      ? null
      : { rangeInvalid: true };
  }

  private shiftsRequiredValidator(group: AbstractControl): ValidationErrors | null {
    const shifts = group.get('shifts') as FormArray | null;
    return shifts && shifts.length > 0 ? null : { shiftsRequired: true };
  }

  private selectedShiftsNotInPastValidator(group: AbstractControl): ValidationErrors | null {
    if (this.editingId() !== null) {
      return null;
    }
    const shifts = (group.get('shifts') as FormArray | null)?.getRawValue() as OrderShiftDto[] | undefined;
    if (!shifts || shifts.length === 0) {
      return null;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const shift of shifts) {
      const d = this.hebrew.parseIso(shift.orderDate);
      if (!d) {
        continue;
      }
      d.setHours(0, 0, 0, 0);
      if (d.getTime() < today.getTime()) {
        return { selectedShiftInPast: true };
      }
    }
    return null;
  }

  /**
   * Friday (JS weekday 5) → Morning only; Saturday (6) → Evening only.
   * Keeps the form invalid if `timeSlot` and `orderDate` disagree (e.g. tampering or timing edge cases).
   */
  private selectedShiftsAllowedValidator(group: AbstractControl): ValidationErrors | null {
    const shifts = (group.get('shifts') as FormArray | null)?.getRawValue() as OrderShiftDto[] | undefined;
    if (!shifts || shifts.length === 0) {
      return null;
    }
    for (const shift of shifts) {
      const d = this.hebrew.parseIso(shift.orderDate);
      if (!d) {
        continue;
      }
      const dow = d.getDay();
      if (dow === 5 && shift.timeSlot !== TimeSlot.Morning) {
        return { shiftNotAllowedForDate: true };
      }
      if (dow === 6 && shift.timeSlot !== TimeSlot.Evening) {
        return { shiftNotAllowedForDate: true };
      }
    }
    return null;
  }

  private returnTimeValidator(group: AbstractControl): ValidationErrors | null {
    const type = group.get('returnTimeType')?.value as ReturnTimeType | undefined;
    const custom = group.get('customReturnTime')?.value;
    if (type !== ReturnTimeType.SpecificTime) {
      return null;
    }
    return typeof custom === 'string' && custom.trim().length > 0
      ? null
      : { returnTimeRequired: true };
  }

  // -----------------------------------------------------------------
  // Hebrew ↔ Gregorian sync
  // -----------------------------------------------------------------

  /**
   * Wires the three Hebrew-date form controls so that:
   *  - selecting a different month/year clamps the day and (in non-leap years) the month;
   *  - any change recomputes the Gregorian `orderDate` and the read-only display;
   *  - the signals that drive `monthOptions` / `dayOptions` track the current values.
   *
   * Also runs once synchronously to initialize the Gregorian display from today's date.
   */
  /**
   * Subscribes the slot-availability probe to all inputs that can affect
   * uniqueness (equipment, time-slot, and the resulting Gregorian date).
   *
   * Hebrew-date changes feed this pipeline through `syncFromHebrew()` which
   * calls `slotCheckTrigger$.next()` after updating `orderDate`. Form changes
   * are debounced and the in-flight request is cancelled by `switchMap`, so
   * rapid dropdown changes only result in a single HTTP call.
   *
   * The check is purely informational: failures and missing fields silently
   * collapse to "not taken", never blocking the user from saving.
   */
  private wireSlotAvailabilityCheck(): void {
    this.selectedEquipmentIdsControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.slotCheckTrigger$.next());

    this.selectedShiftSlots.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.slotCheckTrigger$.next());

    this.slotCheckTrigger$
      .pipe(
        debounceTime(200),
        switchMap(() => {
          const equipmentType = this.selectedEquipmentIdsControl.value[0];
          const selectedShift = (this.selectedShiftSlots.getRawValue() as OrderShiftDto[])[0];

          if (!equipmentType || !this.equipmentSlots.hasSpeakerSlot(equipmentType) || !selectedShift) {
            return of({ taken: false });
          }

          const excludeId = this.editingId() ?? undefined;
          return this.data.checkSlotTaken(equipmentType, selectedShift.orderDate, selectedShift.timeSlot, excludeId);
        }),
        distinctUntilChanged((a, b) => a.taken === b.taken),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((result) => this.slotTakenSig.set(result.taken));
  }

  private wireRangeSync(): void {
    const controls = [
      this.form.controls['startDate'],
      this.form.controls['startShift'],
      this.form.controls['endDate'],
      this.form.controls['endShift']
    ];
    for (const control of controls) {
      control.valueChanges
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(() => this.syncShiftsFromRange());
    }
    this.syncShiftsFromRange();
  }

  private syncShiftsFromRange(): void {
    const startDate = this.form.controls['startDate'].value as string;
    const endDate = this.form.controls['endDate'].value as string;
    let startShift = this.form.controls['startShift'].value as TimeSlot;
    let endShift = this.form.controls['endShift'].value as TimeSlot;
    const startAllowed = this.availableTimeSlots(startDate);
    const endAllowed = this.availableTimeSlots(endDate);
    if (!startAllowed.includes(startShift)) {
      startShift = startAllowed[0] ?? TimeSlot.Morning;
      this.form.controls['startShift'].setValue(startShift, { emitEvent: false });
    }
    if (!endAllowed.includes(endShift)) {
      endShift = endAllowed[endAllowed.length - 1] ?? TimeSlot.Evening;
      this.form.controls['endShift'].setValue(endShift, { emitEvent: false });
    }
    const shifts = this.generateContinuousShifts(startDate, startShift, endDate, endShift);

    this.selectedShiftSlots.clear({ emitEvent: false });
    for (const shift of shifts) {
      this.selectedShiftSlots.push(this.fb.group({
        orderDate: this.fb.nonNullable.control(shift.orderDate),
        timeSlot: this.fb.nonNullable.control(shift.timeSlot)
      }), { emitEvent: false });
    }
    this.form.controls['orderDate'].setValue(startDate, { emitEvent: false });
    this.form.updateValueAndValidity({ emitEvent: false });
    this.slotCheckTrigger$.next();
  }

  private generateContinuousShifts(
    startDate: string,
    startShift: TimeSlot,
    endDate: string,
    endShift: TimeSlot
  ): OrderShiftDto[] {
    if (!startDate || !endDate || startShift == null || endShift == null) {
      return [];
    }
    if (this.compareShiftEndpoints(startDate, startShift, endDate, endShift) > 0) {
      return [];
    }

    const start = this.hebrew.parseIso(startDate);
    const end = this.hebrew.parseIso(endDate);
    if (!start || !end) {
      return [];
    }

    const shifts: OrderShiftDto[] = [];
    for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
      const iso = this.toIso(d);
      for (const timeSlot of this.availableTimeSlots(iso)) {
        if (
          this.compareShiftEndpoints(iso, timeSlot, startDate, startShift) >= 0 &&
          this.compareShiftEndpoints(iso, timeSlot, endDate, endShift) <= 0
        ) {
          shifts.push({ orderDate: iso, timeSlot });
        }
      }
    }
    return shifts;
  }

  private compareShiftEndpoints(
    aDate: string,
    aShift: TimeSlot,
    bDate: string,
    bShift: TimeSlot
  ): number {
    const byDate = aDate.localeCompare(bDate);
    if (byDate !== 0) {
      return byDate;
    }
    return this.shiftOrder(aShift) - this.shiftOrder(bShift);
  }

  private shiftOrder(slot: TimeSlot): number {
    return slot === TimeSlot.Morning ? 1 : 2;
  }

  /**
   * When Phone1 is a valid 9–10 digit value, search the customer directory.
   * If a row matches Phone1 or Phone2, surface a one-click fill for name/address.
   */
  private wireCustomerPhoneLookup(): void {
    this.form.controls['phone'].valueChanges
      .pipe(
        startWith(this.form.controls['phone'].value),
        tap((v) =>
          this.phone1DigitsSig.set(OrderFormComponent.digitsOnly(String(v ?? '')))
        ),
        debounceTime(300),
        map(() => OrderFormComponent.digitsOnly(String(this.form.controls['phone'].value ?? ''))),
        distinctUntilChanged(),
        switchMap((digits) => {
          if (digits.length !== 9 && digits.length !== 10) {
            this.existingCustomerMatch.set(null);
            return EMPTY;
          }
          return this.data.searchCustomers(digits).pipe(map((list) => ({ list, digits })));
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(({ list, digits }) => {
        const current = OrderFormComponent.digitsOnly(String(this.form.controls['phone'].value ?? ''));
        if (current !== digits) {
          return;
        }
        const hit = list.find(
          (c) => c.phone1 === digits || (!!c.phone2 && c.phone2 === digits)
        );
        this.existingCustomerMatch.set(hit ?? null);
      });
  }

  private setNotesArrayLength(group: FormGroup, target: number): void {
    const length = this.toNonNegativeInteger(target);
    group.get('expectedNoteCount')?.setValue(length, { emitEvent: false });
    const notes = group.get('notes') as FormArray<FormControl<string>> | null;
    if (!notes) {
      return;
    }
    while (notes.length < length) {
      notes.push(this.fb.nonNullable.control(''));
    }
    while (notes.length > length) {
      notes.removeAt(notes.length - 1);
    }
  }

  private wireLoanedEquipmentQuantitySync(): void {
    this.equipmentList.controls.forEach((control) => {
      const group = control as FormGroup;
      const quantityCtrl = group.get('quantity');
      if (!quantityCtrl) {
        return;
      }

      quantityCtrl.valueChanges
        .pipe(
          startWith(quantityCtrl.value),
          map((value) => this.toNonNegativeInteger(value)),
          distinctUntilChanged(),
          takeUntilDestroyed(this.destroyRef)
        )
        .subscribe((quantity) => this.setNotesArrayLength(group, quantity));
    });
  }

  private toNonNegativeInteger(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  }

  private wireHebrewRangeSync(): void {
    this.wireHebrewEndpointSync('start');
    this.wireHebrewEndpointSync('end');
  }

  private wireHebrewEndpointSync(endpoint: 'start' | 'end'): void {
    const yearCtrl = this.form.controls[`${endpoint}HebrewYear`];
    const monthCtrl = this.form.controls[`${endpoint}HebrewMonth`];
    const dayCtrl = this.form.controls[`${endpoint}HebrewDay`];

    if (endpoint === 'start') {
      this.startHebrewYearSig.set(Number(yearCtrl.value));
      this.startHebrewMonthSig.set(Number(monthCtrl.value));
    } else {
      this.endHebrewYearSig.set(Number(yearCtrl.value));
      this.endHebrewMonthSig.set(Number(monthCtrl.value));
    }

    this.ensureYearInOptions(Number(yearCtrl.value));
    this.syncHebrewEndpointToIso(endpoint, false);

    yearCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((y) => {
      if (endpoint === 'start') {
        this.startHebrewYearSig.set(Number(y));
      } else {
        this.endHebrewYearSig.set(Number(y));
      }
      this.ensureYearInOptions(Number(y));
      this.normalizeHebrewSelection(endpoint);
      this.syncHebrewEndpointToIso(endpoint, true);
    });

    monthCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((m) => {
      if (endpoint === 'start') {
        this.startHebrewMonthSig.set(Number(m));
      } else {
        this.endHebrewMonthSig.set(Number(m));
      }
      this.normalizeHebrewSelection(endpoint);
      this.syncHebrewEndpointToIso(endpoint, true);
    });

    dayCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      this.normalizeHebrewSelection(endpoint);
      this.syncHebrewEndpointToIso(endpoint, true);
    });
  }

  private normalizeHebrewSelection(endpoint: 'start' | 'end'): void {
    const yearCtrl = this.form.controls[`${endpoint}HebrewYear`];
    const monthCtrl = this.form.controls[`${endpoint}HebrewMonth`];
    const dayCtrl = this.form.controls[`${endpoint}HebrewDay`];

    let year = Number(yearCtrl.value);
    let month = Number(monthCtrl.value);
    let day = Number(dayCtrl.value);

    if (!year || !month || !day) {
      return;
    }

    if (!this.hebrew.isLeapYear(year) && month === 13) {
      month = 12;
      monthCtrl.setValue(month, { emitEvent: false });
      if (endpoint === 'start') {
        this.startHebrewMonthSig.set(month);
      } else {
        this.endHebrewMonthSig.set(month);
      }
    }

    const allowPast = this.editingId() !== null;
    if (!allowPast) {
      const ys = this.yearOptionsForEndpoint(endpoint);
      if (ys.length > 0 && !ys.includes(year)) {
        const y2 = ys.find((yy) => yy >= year) ?? ys[ys.length - 1]!;
        yearCtrl.setValue(y2, { emitEvent: false });
        if (endpoint === 'start') {
          this.startHebrewYearSig.set(y2);
        } else {
          this.endHebrewYearSig.set(y2);
        }
        year = y2;
      }

      const monthOpts = this.monthOptionsForEndpoint(endpoint);
      if (monthOpts.length > 0 && !monthOpts.some((m) => m.value === month)) {
        const m2 = monthOpts[0]!.value;
        monthCtrl.setValue(m2, { emitEvent: false });
        if (endpoint === 'start') {
          this.startHebrewMonthSig.set(m2);
        } else {
          this.endHebrewMonthSig.set(m2);
        }
        month = m2;
      }

      if (this.allowedHebrewDaysInMonth(year, month, false).length === 0) {
        this.patchHebrewToToday(endpoint);
        return;
      }
    }

    year = Number(yearCtrl.value);
    month = Number(monthCtrl.value);
    day = Number(dayCtrl.value);

    const maxDay = this.hebrew.daysInMonth(month, year);
    if (day > maxDay) {
      dayCtrl.setValue(maxDay, { emitEvent: false });
    }

    if (!allowPast) {
      const y = Number(yearCtrl.value);
      const mo = Number(monthCtrl.value);
      const d = Number(dayCtrl.value);
      const allowed = this.allowedHebrewDaysInMonth(y, mo, false);
      if (allowed.length > 0 && !allowed.includes(d)) {
        const nextUp = allowed.find((x) => x >= d) ?? allowed[allowed.length - 1]!;
        dayCtrl.setValue(nextUp, { emitEvent: false });
      }
    }
  }

  /**
   * Hebrew calendar days 1..max for the month. When `allowPast` is false (new order),
   * only days whose Gregorian mapping is today or later (local midnight) are returned
   * — no fallback to past days.
   */
  private allowedHebrewDaysInMonth(year: number, month: number, allowPast: boolean): number[] {
    const max = this.hebrew.daysInMonth(month, year);
    const days = Array.from({ length: max }, (_, i) => i + 1);
    if (allowPast) {
      return days;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return days.filter((d) => {
      const g = this.hebrew.toGregorian(year, month, d);
      g.setHours(0, 0, 0, 0);
      return g.getTime() >= today.getTime();
    });
  }

  /** True if this Hebrew year has at least one month with a selectable today-or-future day (create mode). */
  private hebrewYearHasSelectableFutureDay(year: number): boolean {
    for (const m of this.hebrew.monthsForYear(year)) {
      if (this.allowedHebrewDaysInMonth(year, m.value, false).length > 0) {
        return true;
      }
    }
    return false;
  }

  private patchHebrewToToday(endpoint: 'start' | 'end'): void {
    const parts = this.hebrew.toHebrewParts(new Date());
    this.ensureYearInOptions(parts.year);
    this.form.patchValue(
      {
        [`${endpoint}HebrewYear`]: parts.year,
        [`${endpoint}HebrewMonth`]: parts.month,
        [`${endpoint}HebrewDay`]: parts.day
      },
      { emitEvent: false }
    );
    if (endpoint === 'start') {
      this.startHebrewYearSig.set(parts.year);
      this.startHebrewMonthSig.set(parts.month);
    } else {
      this.endHebrewYearSig.set(parts.year);
      this.endHebrewMonthSig.set(parts.month);
    }
    this.syncHebrewEndpointToIso(endpoint, false);
  }

  private syncHebrewEndpointToIso(endpoint: 'start' | 'end', emitDateChange: boolean): void {
    const year = Number(this.form.controls[`${endpoint}HebrewYear`].value);
    const month = Number(this.form.controls[`${endpoint}HebrewMonth`].value);
    const day = Number(this.form.controls[`${endpoint}HebrewDay`].value);

    const isoControlName = endpoint === 'start' ? 'startDate' : 'endDate';
    const shiftControlName = endpoint === 'start' ? 'startShift' : 'endShift';

    if (!year || !month || !day) {
      return;
    }

    const greg = this.hebrew.toGregorian(year, month, day);
    const iso = this.toIso(greg);
    this.form.controls[isoControlName].setValue(iso, { emitEvent: emitDateChange });
    this.constrainShiftForDate(iso, shiftControlName);
    if (endpoint === 'start') {
      this.form.controls['orderDate'].setValue(iso, { emitEvent: false });
    }
    this.form.updateValueAndValidity({ emitEvent: false });
    if (emitDateChange) {
      this.slotCheckTrigger$.next();
    }
  }

  private constrainShiftForDate(iso: string, shiftControlName: 'startShift' | 'endShift'): void {
    const d = this.hebrew.parseIso(iso);
    if (!d) {
      return;
    }
    const slotCtrl = this.form.controls[shiftControlName];
    const current = slotCtrl.value as TimeSlot;
    const dow = d.getDay();
    if (dow === 5 && current !== TimeSlot.Morning) {
      slotCtrl.setValue(TimeSlot.Morning, { emitEvent: true });
    } else if (dow === 6 && current !== TimeSlot.Evening) {
      slotCtrl.setValue(TimeSlot.Evening, { emitEvent: true });
    }
  }

  private setHebrewFromIso(iso: string, endpoint: 'start' | 'end', emitDateChange = true): void {
    const parts = this.hebrew.isoToHebrewParts(iso);
    if (!parts) {
      return;
    }

    this.ensureYearInOptions(parts.year);
    this.form.patchValue(
      {
        [`${endpoint}HebrewYear`]: parts.year,
        [`${endpoint}HebrewMonth`]: parts.month,
        [`${endpoint}HebrewDay`]: parts.day
      },
      { emitEvent: false }
    );

    if (endpoint === 'start') {
      this.startHebrewYearSig.set(parts.year);
      this.startHebrewMonthSig.set(parts.month);
    } else {
      this.endHebrewYearSig.set(parts.year);
      this.endHebrewMonthSig.set(parts.month);
    }

    this.syncHebrewEndpointToIso(endpoint, emitDateChange);
  }

  private yearOptionsForEndpoint(endpoint: 'start' | 'end'): number[] {
    const currentYear = this.hebrew.toHebrewParts(new Date()).year;
    const base = new Set<number>();
    for (let y = currentYear - 2; y <= currentYear + 5; y++) {
      base.add(y);
    }
    for (const y of this.extraYearsSig()) {
      base.add(y);
    }
    let years = [...base].sort((a, b) => a - b);
    if (this.editingId() === null) {
      const filtered = years.filter((y) => this.hebrewYearHasSelectableFutureDay(y));
      if (filtered.length > 0) {
        years = filtered;
      }
    }
    return years;
  }

  private monthOptionsForEndpoint(endpoint: 'start' | 'end'): HebrewMonthOption[] {
    const year = endpoint === 'start' ? this.startHebrewYearSig() : this.endHebrewYearSig();
    if (!year) {
      return [];
    }
    const all = this.hebrew.monthsForYear(year);
    if (this.editingId() !== null) {
      return all;
    }
    return all.filter((m) => this.allowedHebrewDaysInMonth(year, m.value, false).length > 0);
  }

  private dayOptionsForEndpoint(endpoint: 'start' | 'end'): number[] {
    const year = endpoint === 'start' ? this.startHebrewYearSig() : this.endHebrewYearSig();
    const month = endpoint === 'start' ? this.startHebrewMonthSig() : this.endHebrewMonthSig();
    if (!year || !month) {
      return [];
    }
    const allowPast = this.editingId() !== null;
    return this.allowedHebrewDaysInMonth(year, month, allowPast);
  }

  /** Ensures the given year is selectable in the year dropdown. */
  private ensureYearInOptions(year: number): void {
    if (!year) {
      return;
    }
    const inStart = this.startYearOptions().includes(year);
    const inEnd = this.endYearOptions().includes(year);
    if (!inStart && !inEnd) {
      this.extraYearsSig.update((arr) => (arr.includes(year) ? arr : [...arr, year]));
    }
  }

  private buildEquipmentRow(type: LoanedEquipmentType): FormGroup {
    const notes = this.fb.array<FormControl<string>>([]);
    const g = this.fb.group({
      loanedEquipmentType: this.fb.nonNullable.control(type),
      quantity: this.fb.nonNullable.control(0, [Validators.min(0)]),
      expectedNoteCount: this.fb.nonNullable.control(0, [Validators.min(0)]),
      notes
    });
    return g;
  }

  // -----------------------------------------------------------------
  // Load (edit mode)
  // -----------------------------------------------------------------

  private loadOrder(id: number): void {
    this.data.getOrderById(id).subscribe({
      next: (order) => {
        if (order === null) {
          this.navigateAfterOrderFlow();
          return;
        }
        this.orderCancelled.set(!!order.isCancelled);
        this.existingCustomerMatch.set(null);
        const equipmentDefinitionIds = (order.equipmentDefinitionIds ?? [])
          .filter((id) => this.equipmentSlots.hasSpeakerSlot(id));
        const shifts = [...(order.shifts ?? [])]
          .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || this.shiftOrder(a.timeSlot) - this.shiftOrder(b.timeSlot));
        const firstShift = shifts[0];
        const lastShift = shifts[shifts.length - 1];
        const startIso = firstShift?.orderDate ?? this.form.controls['startDate'].value;
        const endIso =
          lastShift?.orderDate ?? firstShift?.orderDate ?? this.form.controls['endDate'].value;

        this.form.patchValue({
          equipmentDefinitionIds,
          startDate: startIso,
          startShift: firstShift?.timeSlot ?? TimeSlot.Morning,
          endDate: endIso,
          endShift: lastShift?.timeSlot ?? firstShift?.timeSlot ?? TimeSlot.Morning,
          customerName: order.customerName ?? '',
          phone: order.phone,
          phone2: order.phone2 ?? '',
          address: order.address ?? '',
          depositType: order.depositType ?? null,
          depositOnName: order.depositOnName ?? '',
          paymentAmount: order.paymentAmount ?? null,
          isPaid: order.isPaid,
          returnTimeType: order.returnTimeType ?? ReturnTimeType.LateNight,
          customReturnTime: order.customReturnTime ?? '',
          notes: order.notes ?? ''
        });

        this.setHebrewFromIso(startIso, 'start', false);
        this.setHebrewFromIso(endIso, 'end', false);
        this.syncShiftsFromRange();

        // Map server rows → 16 form rows by type.
        const byType = new Map<LoanedEquipmentType, OrderLoanedEquipmentDto>();
        for (const row of order.loanedEquipments) {
          byType.set(row.loanedEquipmentType, row);
        }

        this.equipmentList.controls.forEach((control, idx) => {
          const type = LOANED_EQUIPMENT_ORDER[idx]!;
          const row = byType.get(type);
          const g = control as FormGroup;
          if (!row) {
            g.patchValue({ quantity: 0, expectedNoteCount: 0 }, { emitEvent: false });
            this.setNotesArrayLength(g, 0);
            return;
          }

          const quantity = this.toNonNegativeInteger(row.quantity);
          g.patchValue({ quantity, expectedNoteCount: quantity }, { emitEvent: false });
          this.setNotesArrayLength(g, quantity);
          const notesFa = g.get('notes') as FormArray<FormControl<string>>;
          for (let o = 0; o < quantity; o++) {
            const fromServer = row.notes?.find((n) => n.ordinal === o)?.content ?? '';
            notesFa.at(o).setValue(fromServer ?? '');
          }
        });
        queueMicrotask(() => this.resetScrollForOrderForm());
      }
    });
  }

  // -----------------------------------------------------------------
  // Submit payload
  // -----------------------------------------------------------------

  private toPayload(): OrderCreateUpdateDto {
    const v = this.form.getRawValue() as Record<string, unknown>;

    const loaned: OrderLoanedEquipmentDto[] = (v['loanedEquipments'] as Record<string, unknown>[])
      .filter((row) => Number(row['quantity']) > 0)
      .map((row) => {
        const quantity = this.toNonNegativeInteger(row['quantity']);
        const expected = quantity;
        const notesFa = row['notes'] as unknown;
        const notes: LoanedEquipmentNoteDto[] = [];
        for (let o = 0; o < expected; o++) {
          let text = '';
          if (Array.isArray(notesFa)) {
            const cell = notesFa[o];
            text = typeof cell === 'string' ? cell.trim() : '';
          }
          notes.push({ ordinal: o, content: text.length > 0 ? text : null });
        }
        return {
          loanedEquipmentType: row['loanedEquipmentType'] as LoanedEquipmentType,
          quantity,
          expectedNoteCount: expected,
          notes
        };
      });

    return {
      equipmentDefinitionIds: this.selectedEquipmentIdsControl.value,
      shifts: this.selectedShiftSlots.getRawValue() as OrderShiftDto[],
      customerName: this.optionalText(v['customerName']),
      phone: (v['phone'] as string).trim(),
      phone2: this.optionalText(v['phone2']),
      address: this.optionalText(v['address']),
      depositType: (v['depositType'] as DepositType | null) ?? null,
      depositOnName: this.optionalText(v['depositOnName']),
      paymentAmount: v['paymentAmount'] === '' || v['paymentAmount'] == null
        ? null
        : Math.max(0, Math.trunc(Number(v['paymentAmount']))),
      isPaid: !!v['isPaid'],
      returnTimeType: (v['returnTimeType'] as ReturnTimeType | null) ?? ReturnTimeType.LateNight,
      customReturnTime: (v['returnTimeType'] as ReturnTimeType | null) === ReturnTimeType.SpecificTime
        ? this.optionalText(v['customReturnTime'])
        : null,
      notes: this.optionalText(v['notes']),
      loanedEquipments: loaned,
      // Always allow saving — the form no longer guards against duplicate
      // slot bookings, so we bypass the server's slot-conflict check.
      allowDoubleBooking: true
    };
  }

  /** Trims a form value and returns `null` for blanks so the server stores NULL. */
  private optionalText(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toIso(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}
