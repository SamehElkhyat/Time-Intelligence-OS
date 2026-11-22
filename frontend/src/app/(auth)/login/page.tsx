'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { loginSchema, safeNext, type LoginValues } from '@/features/auth/schemas';
import { ApiError } from '@/lib/api/client';
import { qk } from '@/lib/query-keys';
import { authApi } from '@/services';

const SESSION_COOKIE_BLOCKED =
  'Your credentials are correct, but your browser did not keep the session cookie, so you cannot be signed in. ' +
  'This is a deployment setting: serve the site over HTTPS (or set COOKIE_SECURE=false for plain http), and call the API through the same origin.';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      const session = await authApi.login(values);
      // The password was right, but the app only works if the browser kept the session cookie.
      // A `Secure` cookie sent over plain http (or dropped by a cross-site API URL) is discarded
      // silently, and the route guard would then bounce the user straight back here with no hint.
      try {
        await authApi.session();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          setFormError(SESSION_COOKIE_BLOCKED);
          return;
        }
        throw e;
      }
      qc.setQueryData(qk.session, session);
      router.replace(safeNext(params.get('next')));
    } catch (e) {
      setFormError(e instanceof ApiError ? e.friendly : 'Could not sign in. Please try again.');
    }
  });

  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight text-fg">Welcome back</h1>
      <p className="mt-1.5 text-sm text-fg-secondary">Sign in to see your day.</p>
      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
        {formError && (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {formError}
          </p>
        )}
        <Field label="Email" error={formState.errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" autoFocus placeholder="you@example.com" {...register('email')} />}
        </Field>
        <Field label="Password" error={formState.errors.password?.message}>
          {(p) => <Input {...p} type="password" autoComplete="current-password" {...register('password')} />}
        </Field>
        <div className="text-right">
          <Link href="/forgot-password" className="text-[13px] text-fg-secondary hover:text-primary">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={formState.isSubmitting}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-fg-secondary">
        New to TimeFlow?{' '}
        <Link href="/register" className="font-medium text-primary hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
