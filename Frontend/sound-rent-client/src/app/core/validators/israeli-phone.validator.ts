import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

export const ISRAELI_PHONE_INVALID_MESSAGE = 'מספר טלפון לא תקין';

const LANDLINE_PREFIXES = new Set(['02', '03', '04', '07', '08', '09']);

export function isValidIsraeliPhone(raw: string): boolean {
  const value = raw.trim();
  if (value.length === 0 || !/^\d+$/.test(value)) {
    return false;
  }
  if (value.length === 10 && value.startsWith('05')) {
    return true;
  }
  if (value.length === 9) {
    return LANDLINE_PREFIXES.has(value.slice(0, 2));
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
