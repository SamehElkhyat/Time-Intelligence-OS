'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { forgotSchema } from '@/features/auth/schemas';
import { ApiError } from '@/lib/api/client';
import { authApi } from '@/services';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ email: string }>({ resolver: zodResolver(forgotSchema) });

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(null);
    try {
      await authApi.forgot(email);
      setSent(true);
    } catch (e) {
      setFormError(e instanceof ApiError ? e.friendly : 'Something went wrong. Please try again.');
    }
  });

  if (sent) {
    return (
      <div role="status">
        <MailCheck className="size-8 text-primary" aria-hidden />
        <h1 className="mt-4 text-[26px] font-semibold tracking-tight text-fg">Check your email</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-secondary">If an account exists for that address, we sent a link to reset the password. The link works once and expires in an hour.</p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight text-fg">Reset your password</h1>
      <p className="mt-1.5 text-sm text-fg-secondary">Enter your email and we&apos;ll send you a reset link.</p>
      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
        {formError && <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">{formError}</p>}
        <Field label="Email" error={formState.errors.email?.message}>
          {(p) => <Input {...p} type="email" autoComplete="email" autoFocus {...register('email')} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={formState.isSubmitting}>
          Send reset link
        </Button>
      </form>
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="text-fg-secondary hover:text-primary">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
