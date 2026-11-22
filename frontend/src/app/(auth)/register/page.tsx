'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { registerSchema, type RegisterValues } from '@/features/auth/schemas';
import { ApiError } from '@/lib/api/client';
import { qk } from '@/lib/query-keys';
import { browserTimezone } from '@/lib/time';
import { authApi } from '@/services';

export default function RegisterPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState, setError } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      // The browser's timezone is only a starting point; it can be changed during onboarding.
      const session = await authApi.register({ ...values, timezone: browserTimezone() });
      qc.setQueryData(qk.session, session);
      router.replace('/onboarding');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EMAIL_IN_USE') setError('email', { message: 'An account with this email already exists' });
      else setFormError(e instanceof ApiError ? e.friendly : 'Could not create your account. Please try again.');
    }
  });

  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight text-fg">Create your account</h1>
      <p className="mt-1.5 text-sm text-fg-secondary">Start understanding your time in a minute.</p>
      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
        {formError && (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {formError}
          </p>
        )}
        <Field label="Your name" error={formState.errors.displayName?.message}>
          {(p) => <Input {...p} autoComplete="name" autoFocus {...register('displayName')} />}
        </Field>
        <Field label="Email" error={formState.errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" placeholder="you@example.com" {...register('email')} />}
        </Field>
        <Field label="Password" hint="At least 10 characters. A passphrase works well." error={formState.errors.password?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('password')} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={formState.isSubmitting}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-fg-secondary">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
