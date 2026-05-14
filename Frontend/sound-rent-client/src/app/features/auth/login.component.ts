import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#002244] to-[#003366] px-4">
      <div class="w-full max-w-md">
        <div class="mb-6 text-center text-white">
          <h1 class="text-2xl font-bold">מערכת שבועית</h1>
          <p class="mt-1 text-sm text-sky-200">התחברות למערכת ניהול</p>
        </div>

        <form
          [formGroup]="form"
          (ngSubmit)="submit()"
          class="space-y-5 rounded-2xl bg-white p-8 shadow-2xl"
        >
          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">שם משתמש</label>
            <input
              type="text"
              formControlName="username"
              autocomplete="username"
              class="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            />
            @if (form.controls.username.invalid && form.controls.username.touched) {
              <p class="mt-1 text-xs text-rose-600">יש להזין שם משתמש</p>
            }
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium text-slate-700">סיסמה</label>
            <input
              type="password"
              formControlName="password"
              autocomplete="current-password"
              class="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-slate-900 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
            />
            @if (form.controls.password.invalid && form.controls.password.touched) {
              <p class="mt-1 text-xs text-rose-600">יש להזין סיסמה</p>
            }
          </div>

          @if (errorMessage()) {
            <div class="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              {{ errorMessage() }}
            </div>
          }

          <button
            type="submit"
            [disabled]="submitting()"
            class="flex w-full items-center justify-center rounded-lg bg-[#002244] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#003366] disabled:cursor-not-allowed disabled:opacity-60"
          >
            @if (submitting()) {
              <span class="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
            }
            התחבר
          </button>
        </form>
      </div>
    </div>
  `
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  protected readonly form = this.fb.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required]
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.errorMessage.set(null);

    this.auth.login(this.form.getRawValue()).subscribe({
      next: () => {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl') ?? '/dashboard';
        this.router.navigateByUrl(returnUrl);
      },
      error: (err: HttpErrorResponse) => {
        this.submitting.set(false);
        const apiMessage = err?.error?.message;
        this.errorMessage.set(apiMessage || 'שגיאה בהתחברות. נסו שוב מאוחר יותר');
      }
    });
  }
}
