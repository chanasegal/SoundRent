import { SystemType } from './enums';

export interface CustomerDto {
  phone1: string;
  phone2: string | null;
  fullName: string | null;
  address: string | null;
  notes: string | null;
  updatedAt: string;
  /** Product systems this unified profile is linked to. */
  systemTypes?: SystemType[];
}

export interface CustomerUpsertDto {
  phone1: string;
  phone2?: string | null;
  fullName?: string | null;
  address?: string | null;
  notes?: string | null;
  /** When set, links the customer to this system without duplicating the profile. */
  systemType?: SystemType;
}
