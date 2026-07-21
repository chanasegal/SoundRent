import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const ISRAELI_PHONE_INVALID_MESSAGE = 'מספר טלפון לא תקין';

/** Landline area codes — 9 digits total. */
export const ISRAELI_LANDLINE_PREFIXES = new Set(['02', '03', '04', '07', '08', '09']);

/** Mobile prefix — 10 digits total. */
export const ISRAELI_MOBILE_PREFIX = '05';

const DEFAULT_PHONE_MAX_LENGTH = 10;
const LANDLINE_PHONE_MAX_LENGTH = 9;
const MOBILE_PHONE_MAX_LENGTH = 10;

/**
 * Returns the allowed digit count for the current prefix while typing.
 * Landline (`02`/`03`/`04`/`07`/`08`/`09`) → 9; mobile (`05`) → 10; otherwise 10.
 */
export function getIsraeliPhoneMaxLength(digits: string): number {
  if (digits.length >= 2) {
    const prefix = digits.slice(0, 2);
    if (ISRAELI_LANDLINE_PREFIXES.has(prefix)) {
      return LANDLINE_PHONE_MAX_LENGTH;
    }
    if (prefix === ISRAELI_MOBILE_PREFIX) {
      return MOBILE_PHONE_MAX_LENGTH;
    }
  }
  return DEFAULT_PHONE_MAX_LENGTH;
}

/** Digits only, truncated to the prefix-aware max length. */
export function clampIsraeliPhoneDigits(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits.slice(0, getIsraeliPhoneMaxLength(digits));
}

export function isValidIsraeliPhone(raw: string): boolean {
  const value = raw.trim();
  if (value.length === 0 || !/^\d+$/.test(value)) {
    return false;
  }
  if (value.length === MOBILE_PHONE_MAX_LENGTH && value.startsWith(ISRAELI_MOBILE_PREFIX)) {
    return true;
  }
  if (value.length === LANDLINE_PHONE_MAX_LENGTH) {
    return ISRAELI_LANDLINE_PREFIXES.has(value.slice(0, 2));
  }
  return false;
}

export function israeliPhoneValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const raw = control.value;
    if (raw === null || raw === undefined) {
      return null;
    }
    const value = String(raw).trim();
    if (value.length === 0) {
      return null;
    }
    return isValidIsraeliPhone(value) ? null : { israeliPhone: true };
  };
}

export function optionalIsraeliPhoneValidator(): ValidatorFn {
  return israeliPhoneValidator();
}
