'use client';

import { useQuery } from '@tanstack/react-query';
import { Zap } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { PageHeader } from '@/components/app/primitives';
import { ErrorState, LoadingState, SkeletonCard } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/form';
import { useApiMutation } from '@/hooks/use-mutation-toast';
import { qk } from '@/lib/query-keys';
import { fmtDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { energyApi } from '@/services';
import { LEVELS, type Level } from '@/types';
import { levelLabel } from '../shared/hooks';

const EnergyChart = dynamic(() => import('@/components/app/charts').then((m) => m.EnergyChart), { ssr: false, loading: () => <SkeletonCard lines={5} /> });

function LevelPicker({ label, value, onChange }: { label: string; value: Level | null; onChange: (l: Level) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-medium text-fg-secondary">{label}</legend>
      <div role="radiogroup" aria-label={label} className="grid grid-cols-5 gap-1.5">
        {LEVELS.map((l, i) => (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={value === l}
            onClick={() => onChange(l)}
            className={cn('flex h-14 flex-col items-center justify-center rounded-lg border text-center transition-colors', value === l ? 'border-primary bg-primary-soft text-primary' : 'border-border text-fg-secondary hover:border-border-strong hover:text-fg')}
          >
            <span className="tabular text-lg font-semibold">{i + 1}</span>
            <span className="text-[10.5px] leading-tight">{levelLabel(l)}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function EnergyView() {
  const { tz, use24h } = useAuth();
  const overview = useQuery({ queryKey: qk.energy, queryFn: energyApi.overview });
  const logs = useQuery({ queryKey: qk.energyLogs, queryFn: energyApi.logs });
  const [energy, setEnergy] = useState<Level | null>(null);
  const [focus, setFocus] = useState<Level | null>(null);
  const [note, setNote] = useState('');
  const save = useApiMutation({
    mutationFn: () => energyApi.log({ energy: energy!, focus: focus!, note: note.trim() || undefined }),
    successMessage: 'Check-in saved',
    onSuccess: () => (setEnergy(null), setFocus(null), setNote('')),
  });

  const o = overview.data;
  return (
    <>
      <PageHeader title="Energy" description="Log how you feel. TimeFlow builds your personal rhythm from your own check-ins — it never assumes everyone peaks in the morning." />
      <div className="grid gap-4 lg:grid-cols-[400px_1fr]">
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Zap className="size-4 text-primary" aria-hidden /> How do you feel right now?
              </CardTitle>
              <CardDescription>Takes five seconds. A few a day is plenty.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <LevelPicker label="Energy" value={energy} onChange={setEnergy} />
            <LevelPicker label="Focus" value={focus} onChange={setFocus} />
            <Input aria-label="Note" placeholder="Optional note (e.g. slept badly)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
            <Button variant="primary" className="w-full" disabled={!energy || !focus} loading={save.isPending} onClick={() => save.mutate()}>
              Save check-in
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {overview.isLoading ? (
            <LoadingState />
          ) : overview.isError || !o ? (
            <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />
          ) : (
            <>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div>
                    <div className="text-[13px] text-fg-secondary">Right now</div>
                    {o.current.energy === null ? (
                      <div className="mt-1 text-lg font-medium text-fg-secondary">Unknown — nothing logged yet</div>
                    ) : (
                      <div className="tabular mt-1 text-2xl font-semibold text-fg">
                        Energy <span className="text-primary">{o.current.energy.toFixed(1)}</span>/5 · Focus <span className="text-info">{(o.current.focus ?? 0).toFixed(1)}</span>/5
                      </div>
                    )}
                  </div>
                  <Badge tone={o.current.source === 'LOGGED' ? 'success' : o.current.source === 'UNKNOWN' ? 'warning' : 'info'}>
                    {o.current.source === 'LOGGED' ? 'From your check-in' : o.current.source === 'FORECAST' ? 'Expected from your history' : o.current.source === 'DECLARED' ? 'From your declared focus window' : 'No basis yet'}
                  </Badge>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>Your typical day</CardTitle>
                    <CardDescription>
                      {o.sampleSize === 0 ? 'No check-ins yet, so there is nothing to chart. Hours without data are left blank, not guessed.' : `Built from ${o.sampleSize} check-in${o.sampleSize === 1 ? '' : 's'} · confidence ${o.confidence}%`}
                    </CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <EnergyChart hours={o.forecast} />
                  <div className="mt-2 flex gap-5 text-xs text-fg-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="h-0.5 w-4 bg-primary" /> Energy
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden className="h-0.5 w-4 border-t-2 border-dashed border-info" /> Focus
                    </span>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Recent check-ins</CardTitle>
            </CardHeader>
            <CardContent>
              {logs.isLoading ? (
                <LoadingState />
              ) : !logs.data?.length ? (
                <p className="text-sm text-fg-secondary">No check-ins in the last 14 days.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {logs.data.slice(0, 8).map((l) => (
                    <li key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm first:pt-0 last:pb-0">
                      <span className="tabular text-fg-secondary">{fmtDateTime(l.recordedAt, tz, use24h)}</span>
                      <span className="text-fg">
                        Energy {levelLabel(l.energy)} · Focus {levelLabel(l.focus)}
                        {l.note && <span className="text-fg-muted"> — {l.note}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
