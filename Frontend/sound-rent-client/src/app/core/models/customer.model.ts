export interface CustomerDto {
  phone1: string;
  phone2: string | null;
  fullName: string | null;
  address: string | null;
  notes: string | null;
  updatedAt: string;
}

export interface CustomerUpsertDto {
  phone1: string;
  phone2?: string | null;
  fullName?: string | null;
  address?: string | null;
  notes?: string | null;
}
