/**
 * Detects hardware barcode scanners that emulate a keyboard wedge:
 * a burst of keystrokes ending with Enter.
 *
 * Use on `document:keydown` when no editable field is focused.
 */
export class BarcodeWedgeScanner {
  private buffer = '';
  private lastAt = 0;

  constructor(
    private readonly maxIntervalMs = 50,
    private readonly minChars = 3
  ) {}

  /**
   * Feeds a keydown event. Returns the scanned string when Enter completes
   * a sufficiently long, fast burst; otherwise null.
   */
  push(event: KeyboardEvent): string | null {
    if (isEditableTarget(event.target)) {
      this.reset();
      return null;
    }

    if (event.ctrlKey || event.altKey || event.metaKey) {
      this.reset();
      return null;
    }

    const now = performance.now();

    if (event.key === 'Enter') {
      const code = this.buffer.trim();
      this.reset();
      if (code.length >= this.minChars) {
        event.preventDefault();
        return code;
      }
      return null;
    }

    if (event.key === 'Escape') {
      this.reset();
      return null;
    }

    // Ignore non-character keys (Shift, Tab, arrows, …).
    if (event.key.length !== 1) {
      return null;
    }

    if (this.lastAt > 0 && now - this.lastAt > this.maxIntervalMs) {
      this.buffer = '';
    }

    this.buffer += event.key;
    this.lastAt = now;
    event.preventDefault();
    return null;
  }

  reset(): void {
    this.buffer = '';
    this.lastAt = 0;
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) {
    return false;
  }
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true;
  }
  return el.isContentEditable === true;
}
