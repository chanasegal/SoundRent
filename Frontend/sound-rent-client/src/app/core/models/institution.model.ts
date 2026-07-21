import { SystemType } from './enums';

export interface InstitutionDto {
  id: number;
  name: string;
  defaultNote?: string | null;
  systemTypes?: SystemType[];
}

export interface InstitutionCreateUpdateDto {
  name: string;
  defaultNote?: string | null;
  systemType?: SystemType | null;
}
