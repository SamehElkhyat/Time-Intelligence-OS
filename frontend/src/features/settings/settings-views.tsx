'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Laptop, LogOut, MailCheck, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { PageHeader } from '@/components/app/primitives';
import { ErrorState, LoadingState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { changePasswordSchema } from '@/features/auth/schemas';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { qk } from '@/lib/query-keys';
import { fmtDateTime, fromNow } from '@/lib/time';
import { initials } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { authApi, userApi } from '@/services';
import { useQueryClient } from '@tanstack/react-query';
import { PreferencesForm } from './preferences-form';

const profileSchema = z.object({ displayName: z.string().trim().min(1, 'Enter your name').max(80, 'Use 80 characters or fewer') });

export function ProfileView() {
  const { user, tz, use24h } = useAuth();
  const qc = useQueryClient();
  const { register, handleSubmit, formState } = useForm<{ displayName: string }>({ resolver: zodResolver(profileSchema), defaultValues: { displayName: user.displayName } });
  const save = useApiMutation({ mutationFn: (v: { displayName: string }) => userApi.updateProfile(v.displayName), successMessage: 'Profile updated', onSuccess: () => qc.invalidateQueries({ queryKey: qk.session }) });
  const resend = useApiMutation({ mutationFn: () => authApi.resendVerification(), successMessage: 'Verification email sent', invalidate: false });
  return (
    <>
      <PageHeader title="Profile" />
      <div className="max-w-2xl space-y-4">
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <span className="grid size-16 place-items-center rounded-full bg-primary-soft text-xl font-semibold text-primary">{initials(user.displayName)}</span>
            <div>
              <div className="text-lg font-semibold text-fg">{user.displayName}</div>
              <div className="text-sm text-fg-secondary">{user.email}</div>
              <div className="mt-1.5 flex gap-2">
                {user.isDemo && <Badge tone="warning">Demo account</Badge>}
                <Badge tone={user.emailVerified ? 'success' : 'warning'}>{user.emailVerified ? 'Email verified' : 'Email not verified'}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Your details</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((v) => save.mutate(v))} noValidate className="space-y-4">
              <Field label="Display name" error={formState.errors.displayName?.message}>
                {(p) => <Input {...p} {...register('displayName')} />}
              </Field>
              <Field label="Email" hint="Your sign-in address cannot be changed here.">
                {(p) => <Input {...p} value={user.email} readOnly disabled />}
              </Field>
              <div className="flex gap-2">
                <Button type="submit" variant="primary" loading={save.isPending} disabled={!formState.isDirty}>
                  Save
                </Button>
                {!user.emailVerified && !user.isDemo && (
                  <Button variant="secondary" loading={resend.isPending} onClick={() => resend.mutate()}>
                    <MailCheck className="size-4" /> Resend verification
                  </Button>
                )}
              </div>
            </form>
            <p className="mt-5 border-t border-border pt-4 text-xs text-fg-muted">
              Member since {fmtDateTime(user.createdAt, tz, use24h)} · Time zone {tz}
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export function PreferencesView() {
  const { preference } = useAuth();
  return (
    <>
      <PageHeader title="Preferences" description="Your time zone, working hours and scheduling rules. They shape every availability calculation." />
      <Card className="max-w-3xl">
        <CardContent className="p-6">
          <PreferencesForm preference={preference} />
        </CardContent>
      </Card>
    </>
  );
}

export function SettingsView() {
  const { user, signOut, tz, use24h } = useAuth();
  const qc = useQueryClient();
  const devices = useQuery({ queryKey: qk.devices, queryFn: authApi.devices });
  const [msg, setMsg] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState } = useForm<{ currentPassword: string; newPassword: string; confirm: string }>({ resolver: zodResolver(changePasswordSchema) });
  const change = useApiMutation({
    mutationFn: (v: { currentPassword: string; newPassword: string }) => authApi.changePassword({ currentPassword: v.currentPassword, newPassword: v.newPassword }),
    invalidate: false,
    successMessage: 'Password changed — other devices were signed out',
    onSuccess: async () => (reset(), setMsg(null), await qc.invalidateQueries({ queryKey: qk.devices })),
  });
  const revoke = useApiMutation({ mutationFn: (id: string) => authApi.revokeDevice(id), invalidate: false, successMessage: 'Device signed out', onSuccess: () => qc.invalidateQueries({ queryKey: qk.devices }) });
  const revokeOthers = useApiMutation({ mutationFn: () => authApi.revokeOthers(), invalidate: false, successMessage: (r) => `Signed out ${r.revoked} other device${r.revoked === 1 ? '' : 's'}`, onSuccess: () => qc.invalidateQueries({ queryKey: qk.devices }) });

  return (
    <>
      <PageHeader title="Settings" description="Account security and signed-in devices." />
      <div className="grid max-w-4xl gap-4">
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Change password</CardTitle>
              <CardDescription>Changing it signs out every other device.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((v) => change.mutate(v))} noValidate className="grid max-w-md gap-4">
              <Field label="Current password" error={formState.errors.currentPassword?.message}>
                {(p) => <Input {...p} type="password" autoComplete="current-password" {...register('currentPassword')} />}
              </Field>
              <Field label="New password" hint="At least 10 characters." error={formState.errors.newPassword?.message}>
                {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('newPassword')} />}
              </Field>
              <Field label="Confirm new password" error={formState.errors.confirm?.message}>
                {(p) => <Input {...p} type="password" autoComplete="new-password" {...register('confirm')} />}
              </Field>
              {msg && <p role="alert" className="text-xs text-danger">{msg}</p>}
              <div>
                <Button type="submit" variant="primary" loading={change.isPending} disabled={user.isDemo} title={user.isDemo ? 'The demo password cannot be changed' : undefined}>
                  Update password
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Signed-in devices</CardTitle>
              <CardDescription>Sessions expire automatically. Sign out anything you do not recognise.</CardDescription>
            </div>
            <Button variant="outline" size="sm" loading={revokeOthers.isPending} disabled={(devices.data?.length ?? 0) < 2} onClick={() => revokeOthers.mutate()}>
              Sign out other devices
            </Button>
          </CardHeader>
          <CardContent>
            {devices.isLoading ? (
              <LoadingState />
            ) : devices.isError || !devices.data ? (
              <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />
            ) : (
              <ul className="divide-y divide-border">
                {devices.data.map((d) => {
                  const mobile = /mobile|android|iphone/i.test(d.userAgent ?? '');
                  const Icon = mobile ? Smartphone : Laptop;
                  return (
                    <li key={d.id} className="flex items-center gap-4 py-3.5 first:pt-0 last:pb-0">
                      <Icon className="size-5 shrink-0 text-fg-muted" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-fg">
                          {summariseAgent(d.userAgent)} {d.current && <Badge tone="primary" className="ml-1.5">This device</Badge>}
                        </div>
                        <div className="text-xs text-fg-muted">
                          {d.ipAddress ?? 'Unknown address'} · signed in {fmtDateTime(d.createdAt, tz, use24h)} · active {fromNow(d.lastSeenAt)}
                        </div>
                      </div>
                      {!d.current && (
                        <Button variant="ghost" size="sm" loading={revoke.isPending && revoke.variables === d.id} onClick={() => revoke.mutate(d.id)}>
                          Sign out
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <div className="text-sm font-medium text-fg">Sign out of this device</div>
              <div className="text-[13px] text-fg-secondary">You can sign back in at any time.</div>
            </div>
            <Button variant="danger" onClick={() => void signOut()}>
              <LogOut className="size-4" /> Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export function summariseAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /edg\//i.test(ua) ? 'Edge' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Browser';
  const os = /windows/i.test(ua) ? 'Windows' : /android/i.test(ua) ? 'Android' : /iphone|ipad|ios/i.test(ua) ? 'iOS' : /mac os/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : 'unknown OS';
  return `${browser} on ${os}`;
}
