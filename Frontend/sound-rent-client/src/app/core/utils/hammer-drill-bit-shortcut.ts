import { ToolDefinitionDto } from '../models/tools-workspace.model';

/** Drill-bit sizes eligible for the hammer-drill shortcut (longest first for parsing). */
export const HAMMER_DRILL_BIT_SIZES = ['111', '14', '13', '12', '10', '9', '8', '7', '6', '5'] as const;

export type HammerDrillBitSize = (typeof HAMMER_DRILL_BIT_SIZES)[number];

const HAMMER_DRILL_BIT_SIZE_SET = new Set<string>(HAMMER_DRILL_BIT_SIZES);

export function hammerDrillBitDisplayName(size: string): string {
  return `קודח ${size} לפטישון`;
}

export function isHammerDrillBitSize(size: string): size is HammerDrillBitSize {
  return HAMMER_DRILL_BIT_SIZE_SET.has(size);
}

export function isHammerDrillBitDisplayName(displayName: string): boolean {
  const match = displayName.trim().match(/^קודח (\d+) לפטישון$/u);
  return match !== null && isHammerDrillBitSize(match[1]);
}

export function findHammerDrillBitTool(
  definitions: ToolDefinitionDto[],
  size: string
): ToolDefinitionDto | undefined {
  if (!isHammerDrillBitSize(size)) {
    return undefined;
  }
  const expected = hammerDrillBitDisplayName(size);
  return definitions.find((tool) => tool.displayName.trim() === expected);
}

export interface HammerDrillBitShortcutParse {
  size: HammerDrillBitSize;
  displayName: string;
  codes: string[];
}

export interface LoanLineHammerDrillProbe {
  toolId: number | null;
  toolQuery: string;
}

/**
 * Parses shortcut input such as "10", "קודח 10", or "111 1".
 * Returns null when the text does not match the strict hammer-drill bit list.
 */
export function parseHammerDrillBitShortcutInput(raw: string): HammerDrillBitShortcutParse | null {
  const input = raw.trim();
  if (!input) {
    return null;
  }

  for (const size of HAMMER_DRILL_BIT_SIZES) {
    const displayName = hammerDrillBitDisplayName(size);
    if (input === displayName) {
      return { size, displayName, codes: [] };
    }
    if (input.startsWith(`${displayName} `) || input.startsWith(`${displayName}\t`)) {
      const remainder = input.slice(displayName.length).trim();
      const codes = remainder
        .split(/[\s,;|/\\]+/u)
        .map((token) => token.trim())
        .filter(Boolean);
      return { size, displayName, codes };
    }
  }

  const tokens = input.split(/[\s,;|/\\]+/u).map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  let sizeToken: string | null = null;
  let codeStartIndex = 0;

  if (tokens[0].toLocaleLowerCase() === 'קודח') {
    if (tokens.length < 2) {
      return null;
    }
    sizeToken = tokens[1];
    codeStartIndex = 2;
  } else {
    sizeToken = tokens[0];
    codeStartIndex = 1;
  }

  if (!sizeToken || !isHammerDrillBitSize(sizeToken)) {
    return null;
  }

  return {
    size: sizeToken,
    displayName: hammerDrillBitDisplayName(sizeToken),
    codes: tokens.slice(codeStartIndex)
  };
}

/** Whether the query is a partial hammer-drill bit shortcut (for suggest filtering). */
export function isPartialHammerDrillBitShortcutQuery(raw: string): boolean {
  const input = raw.trim();
  if (!input) {
    return false;
  }

  const exact = parseHammerDrillBitShortcutInput(input);
  if (exact && exact.codes.length === 0) {
    return true;
  }

  if (/^\d+$/u.test(input)) {
    return HAMMER_DRILL_BIT_SIZES.some((size) => size.startsWith(input));
  }

  const kodachPrefix = input.match(/^קודח(?:\s+(.*))?$/iu);
  if (!kodachPrefix) {
    return false;
  }

  const rest = (kodachPrefix[1] ?? '').trim();
  if (!rest) {
    return true;
  }

  return /^\d+$/u.test(rest) && HAMMER_DRILL_BIT_SIZES.some((size) => size.startsWith(rest));
}

export function matchingHammerDrillBitTools(
  definitions: ToolDefinitionDto[],
  query: string
): ToolDefinitionDto[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const exactShortcut = parseHammerDrillBitShortcutInput(trimmed);
  if (exactShortcut && exactShortcut.codes.length === 0) {
    const tool = findHammerDrillBitTool(definitions, exactShortcut.size);
    return tool ? [tool] : [];
  }

  if (/^\d+$/u.test(trimmed)) {
    return HAMMER_DRILL_BIT_SIZES.filter((size) => size.startsWith(trimmed))
      .map((size) => findHammerDrillBitTool(definitions, size))
      .filter((tool): tool is ToolDefinitionDto => !!tool);
  }

  const kodachMatch = trimmed.match(/^קודח(?:\s+(.*))?$/iu);
  if (!kodachMatch) {
    return [];
  }

  const rest = (kodachMatch[1] ?? '').trim();
  if (!rest) {
    return HAMMER_DRILL_BIT_SIZES.map((size) => findHammerDrillBitTool(definitions, size)).filter(
      (tool): tool is ToolDefinitionDto => !!tool
    );
  }

  if (!/^\d+$/u.test(rest)) {
    return [];
  }

  return HAMMER_DRILL_BIT_SIZES.filter((size) => size.startsWith(rest))
    .map((size) => findHammerDrillBitTool(definitions, size))
    .filter((tool): tool is ToolDefinitionDto => !!tool);
}

export function formHasHammerDrill(
  lines: LoanLineHammerDrillProbe[],
  resolveDisplayName: (toolId: number) => string | undefined
): boolean {
  return lines.some((line) => {
    if (line.toolQuery.includes('פטישון')) {
      return true;
    }
    if (line.toolId != null) {
      const displayName = resolveDisplayName(line.toolId);
      return displayName?.includes('פטישון') ?? false;
    }
    return false;
  });
}

/** Input that should be expanded live to the full catalog display name. */
export function shouldAutoCompleteHammerDrillBitName(raw: string): HammerDrillBitShortcutParse | null {
  const parsed = parseHammerDrillBitShortcutInput(raw);
  if (!parsed || parsed.codes.length > 0) {
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed === parsed.size || trimmed.toLocaleLowerCase() === `קודח ${parsed.size}`.toLocaleLowerCase()) {
    return parsed;
  }

  return null;
}
