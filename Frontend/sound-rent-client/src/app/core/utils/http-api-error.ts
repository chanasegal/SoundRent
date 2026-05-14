import { HttpErrorResponse } from '@angular/common/http';

/**
 * Extracts a user-facing message from API error payloads (middleware JSON or ProblemDetails).
 */
export function getApiErrorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error;
    if (body && typeof body === 'object' && 'message' in body) {
      const m = (body as { message?: unknown }).message;
      if (typeof m === 'string' && m.trim().length > 0) {
        return m.trim();
      }
    }
    if (typeof body === 'string' && body.trim().length > 0) {
      return body.trim();
    }
    switch (error.status) {
      case 400:
        return 'הבקשה נדחתה — בדקו את הנתונים';
      case 401:
        return 'נדרשת התחברות מחדש';
      case 403:
        return 'אין הרשאה לביצוע הפעולה';
      case 404:
        return 'הפריט לא נמצא';
      case 409:
        return 'הנתונים התנגשו עם מצב קיים — נסו שוב';
      case 500:
        return 'שגיאת שרת — נסו שוב מאוחר יותר';
      default:
        return error.message?.trim() || 'אירעה שגיאה';
    }
  }
  return 'אירעה שגיאה';
}
