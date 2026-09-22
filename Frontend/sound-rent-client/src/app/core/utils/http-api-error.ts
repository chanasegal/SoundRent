import { HttpErrorResponse } from '@angular/common/http';

/**
 * Extracts a user-facing message from API error payloads (middleware JSON or ProblemDetails).
 */
export function getApiErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const fromBody = readApiErrorBodyMessage(error.error);
    if (fromBody) {
      return fromBody;
    }
    switch (error.status) {
      case 0:
        return 'לא ניתן להתחבר לשרת — בדקו את החיבור ונסו שוב';
      case 400:
        return 'הבקשה נדחתה — בדקו את הנתונים';
      case 401:
        return 'נדרשת התחברות מחדש';
      case 403:
        return 'אין הרשאה לביצוע הפעולה';
      case 404:
        return 'הפריט לא נמצא';
      case 408:
      case 504:
        return 'פג הזמן להמתנה לתשובת השרת — נסו שוב עם פחות שינויים בבת אחת';
      case 409:
        return 'הנתונים התנגשו עם מצב קיים — נסו שוב';
      case 500:
      case 502:
      case 503:
        return 'שגיאת שרת — נסו שוב מאוחר יותר';
      default:
        return error.message?.trim() || 'אירעה שגיאה';
    }
  }
  return 'אירעה שגיאה';
}

/** Reads `message` / ProblemDetails `detail` / `title` from API JSON (or plain text). */
function readApiErrorBodyMessage(body: unknown): string | null {
  if (body == null) {
    return null;
  }
  if (typeof body === 'string') {
    const trimmed = body.trim();
    // Gateway HTML / empty pages are not useful to show as-is.
    if (!trimmed || trimmed.startsWith('<')) {
      return null;
    }
    return trimmed;
  }
  if (typeof body !== 'object') {
    return null;
  }
  const obj = body as Record<string, unknown>;
  for (const key of ['message', 'detail', 'title'] as const) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  // ASP.NET model-state style: { errors: { field: ["msg"] } }
  const errors = obj['errors'];
  if (errors && typeof errors === 'object') {
    const parts: string[] = [];
    for (const messages of Object.values(errors as Record<string, unknown>)) {
      if (Array.isArray(messages)) {
        for (const m of messages) {
          if (typeof m === 'string' && m.trim()) {
            parts.push(m.trim());
          }
        }
      } else if (typeof messages === 'string' && messages.trim()) {
        parts.push(messages.trim());
      }
    }
    if (parts.length > 0) {
      return parts.join('; ');
    }
  }
  return null;
}
