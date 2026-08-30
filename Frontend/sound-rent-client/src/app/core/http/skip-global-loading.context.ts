import { HttpContextToken } from '@angular/common/http';

/** When true, the global loading overlay is not shown for this request. */
export const SKIP_GLOBAL_LOADING = new HttpContextToken<boolean>(() => false);
