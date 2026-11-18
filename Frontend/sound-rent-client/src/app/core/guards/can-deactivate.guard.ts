import { CanDeactivateFn, RouterStateSnapshot } from '@angular/router';
import { Observable } from 'rxjs';

export interface CanComponentDeactivate {
  canDeactivate: (
    nextState?: RouterStateSnapshot
  ) => Observable<boolean> | Promise<boolean> | boolean;
}

export const canDeactivateGuard: CanDeactivateFn<CanComponentDeactivate> = (
  component,
  _currentRoute,
  _currentState,
  nextState
) => {
  if (!component?.canDeactivate) {
    return true;
  }
  return component.canDeactivate(nextState);
};
