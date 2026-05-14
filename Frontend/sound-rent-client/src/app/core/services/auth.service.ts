import { HttpClient } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import { AuthResponse, LoginRequest } from '../models/auth.model';

const TOKEN_KEY = 'soundrent.token';
const USER_KEY = 'soundrent.username';
const EXPIRES_KEY = 'soundrent.expires';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly _token = signal<string | null>(this.readToken());
  private readonly _username = signal<string | null>(localStorage.getItem(USER_KEY));

  readonly token = this._token.asReadonly();
  readonly username = this._username.asReadonly();
  readonly isAuthenticated = computed(() => !!this._token());

  login(request: LoginRequest) {
    return this.http
      .post<AuthResponse>(`${environment.apiBaseUrl}/auth/login`, request)
      .pipe(tap((response) => this.persist(response)));
  }

  logout(redirect = true): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(EXPIRES_KEY);
    this._token.set(null);
    this._username.set(null);
    if (redirect) {
      this.router.navigate(['/login']);
    }
  }

  private persist(response: AuthResponse): void {
    localStorage.setItem(TOKEN_KEY, response.token);
    localStorage.setItem(USER_KEY, response.username);
    localStorage.setItem(EXPIRES_KEY, response.expiresAt);
    this._token.set(response.token);
    this._username.set(response.username);
  }

  private readToken(): string | null {
    const token = localStorage.getItem(TOKEN_KEY);
    const expires = localStorage.getItem(EXPIRES_KEY);
    if (!token || !expires) {
      return null;
    }
    if (new Date(expires).getTime() <= Date.now()) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(EXPIRES_KEY);
      return null;
    }
    return token;
  }
}
