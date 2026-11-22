'use client';

import { CheckCircle2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { LoadingState } from '@/components/app/states';
import { ApiError } from '@/lib/api/client';
import { authApi } from '@/services';

function Verify() {
  const token = useSearchParams().get('token');
  const [state, setState] = useState<'working' | 'ok' | 'error'>(token ? 'working' : 'error');
  const [message, setMessage] = useState('This verification link is incomplete.');
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return; // the token is single-use: never submit it twice (React strict mode)
    ran.current = true;
    authApi
      .verifyEmail(token)
      .then(() => setState('ok'))
      .catch((e) => {
        setMessage(e instanceof ApiError ? e.friendly : 'We could not verify your email.');
        setState('error');
      });
  }, [token]);

  if (state === 'working') return <LoadingState label="Verifying your email…" />;
  return (
    <div role="status">
      {state === 'ok' ? <CheckCircle2 className="size-8 text-success" aria-hidden /> : <XCircle className="size-8 text-danger" aria-hidden />}
      <h1 className="mt-4 text-[26px] font-semibold tracking-tight text-fg">{state === 'ok' ? 'Email verified' : 'Verification failed'}</h1>
      <p className="mt-2 text-sm text-fg-secondary">{state === 'ok' ? 'Thanks — your address is confirmed.' : message}</p>
      <Button asChild variant="primary" className="mt-6">
        <Link href="/">Continue to TimeFlow</Link>
      </Button>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
