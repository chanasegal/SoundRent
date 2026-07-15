import { Injectable, signal } from '@angular/core';

import { SystemType, SYSTEM_TYPE_OPTIONS } from '../models/enums';

const STORAGE_KEY = 'soundrent.currentSystemType';

function parseSystemType(raw: string | null): SystemType {
  if (raw === SystemType.Library || raw === 'Library' || raw === '2') {
    return SystemType.Library;
  }
  if (raw === SystemType.Tools || raw === 'Tools' || raw === '1') {
    return SystemType.Tools;
  }
  if (raw === SystemType.Sound || raw === 'Sound' || raw === '0') {
    return SystemType.Sound;
  }
  return SystemType.Sound;
}

function isSelectableWorkspace(systemType: SystemType): boolean {
  return (SYSTEM_TYPE_OPTIONS as readonly SystemType[]).includes(systemType);
}

@Injectable({ providedIn: 'root' })
export class SystemContextService {
  private readonly currentSystemTypeSignal = signal<SystemType>(this.readStored());

  readonly currentSystemType = this.currentSystemTypeSignal.asReadonly();

  setSystemType(systemType: SystemType): void {
    const next = isSelectableWorkspace(systemType) ? systemType : SystemType.Sound;
    if (this.currentSystemTypeSignal() === next) {
      return;
    }
    this.currentSystemTypeSignal.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage failures
    }
  }

  /** URL segment for Tools / Library shells (Sound uses legacy routes). */
  workspaceSlug(systemType: SystemType = this.currentSystemTypeSignal()): 'tools' | 'library' | 'sound' {
    if (systemType === SystemType.Library) {
      return 'library';
    }
    if (systemType === SystemType.Tools) {
      return 'tools';
    }
    return 'sound';
  }

  workspaceBasePath(systemType: SystemType = this.currentSystemTypeSignal()): string {
    const slug = this.workspaceSlug(systemType);
    if (slug === 'sound') {
      return '';
    }
    return `/${slug}`;
  }

  /** Home URL for the active (or given) system. */
  workspaceHomePath(systemType: SystemType = this.currentSystemTypeSignal()): string {
    if (systemType === SystemType.Library) {
      return '/library/lending';
    }
    if (systemType === SystemType.Tools) {
      return '/tools/lending';
    }
    return '/dashboard';
  }

  workspaceCustomersPath(systemType: SystemType = this.currentSystemTypeSignal()): string {
    if (systemType === SystemType.Sound) {
      return '/admin/customers';
    }
    return `${this.workspaceBasePath(systemType)}/customers`;
  }

  systemTypeFromSlug(slug: string | null | undefined): SystemType {
    if (slug === 'library') {
      return SystemType.Library;
    }
    if (slug === 'tools') {
      return SystemType.Tools;
    }
    return SystemType.Sound;
  }

  private readStored(): SystemType {
    try {
      const parsed = parseSystemType(localStorage.getItem(STORAGE_KEY));
      if (!isSelectableWorkspace(parsed)) {
        localStorage.setItem(STORAGE_KEY, SystemType.Sound);
        return SystemType.Sound;
      }
      return parsed;
    } catch {
      return SystemType.Sound;
    }
  }
}
