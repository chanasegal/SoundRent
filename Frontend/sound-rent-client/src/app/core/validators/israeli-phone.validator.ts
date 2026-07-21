import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const ISRAELI_PHONE_INVALID_MESSAGE = 'מספר טלפון אינו תקין';

/**
 * Combined Israeli phone pattern:
 * - 05x / 07x → 10 digits (cellular / VoIP)
 * - 02 / 03 / 04 / 08 / 09 → 9 digits (regional landline)
 */
export const ISRAELI_PHONE_REGEX = /^0(5\d|7\d|[23489])\d{7}$/;

/** Regional landline area codes — 9 digits total. */
export const ISRAELI_LANDLINE_PREFIXES = new Set(['02', '03', '04', '08', '09']);

/** 10-digit prefixes: cellular (05) and VoIP/landline (07). */
export const ISRAELI_TEN_DIGIT_PREFIXES = new Set(['05', '07']);

const DEFAULT_PHONE_MAX_LENGTH = 10;
const LANDLINE_PHONE_MAX_LENGTH = 9;
const TEN_DIGIT_PHONE_MAX_LENGTH = 10;

/**
 * Returns the allowed digit count for the current prefix while typing.
 * Landline (`02`/`03`/`04`/`08`/`09`) → 9; `05`/`07` → 10; otherwise 10.
 */
export function getIsraeliPhoneMaxLength(digits: string): number {
  if (digits.length >= 2) {
    const prefix = digits.slice(0, 2);
    if (ISRAELI_LANDLINE_PREFIXES.has(prefix)) {
      return LANDLINE_PHONE_MAX_LENGTH;
    }
    if (ISRAELI_TEN_DIGIT_PREFIXES.has(prefix)) {
      return TEN_DIGIT_PHONE_MAX_LENGTH;
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
  return ISRAELI_PHONE_REGEX.test(value);
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
