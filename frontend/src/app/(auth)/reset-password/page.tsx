'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { resetSchema } from '@/features/auth/schemas';
import { ApiError } from '@/lib/api/client';
import { authApi } from '@/services';

function ResetForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [formError, setFormError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ newPassword: string; confirm: string }>({ resolver: zodResolver(resetSchema) });

  const onSubmit = handleSubmit(async ({ newPassword }) => {
    setFormError(null);
    try {
      await authApi.reset({ token, newPassword });
      toast.success('Password updated. Sign in with your new password.');
      router.replace('/login');
    } catch (e) {
      setFormError(e instanceof ApiError ? e.friendly : 'Could not reset the password.');
    }
  });

  if (!token) {
    return (
      <div role="alert">
        <h1 className="text-[26px] font-semibold tracking-tight text-fg">This link is incomplete</h1>
        <p className="mt-2 text-sm text-fg-secondary">Request a new password reset link to continue.</p>
        <Button asChild variant="outline" className="mt-6">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }
  return (
    <>
      <h1 className="text-[26px] font-semibold tracking-tight text-fg">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-fg-secondary">You will be signed out everywhere.</p>
      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
        {formError && <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[13px] text-danger">{formError}</p>}
        <Field label="New password" error={formState.errors.newPassword?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" autoFocus {...register('newPassword')} />}
        </Field>
        <Field label="Confirm new password" error={formState.errors.confirm?.message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('confirm')} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={formState.isSubmitting}>
          Update password
        </Button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
