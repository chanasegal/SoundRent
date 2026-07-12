export interface InstitutionDto {
  id: number;
  name: string;
  defaultNote?: string | null;
}

export interface InstitutionCreateUpdateDto {
  name: string;
  defaultNote?: string | null;
}
