'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Info, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { RecommendationCard } from '@/components/app/cards';
import { PageHeader } from '@/components/app/primitives';
import { EmptyState, ErrorState, LoadingState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { errorMessage, useApiMutation } from '@/hooks/use-mutation-toast';
import { qk } from '@/lib/query-keys';
import { useAuth } from '@/providers/auth-provider';
import { recommendationApi } from '@/services';
import { LEVELS, type Level, type RecommendationBatch } from '@/types';
import { levelLabel } from '../shared/hooks';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

function Inner() {
  const { tz, use24h } = useAuth();
  const qc = useQueryClient();
  const params = useSearchParams();
  const [minutes, setMinutes] = useState(params.get('minutes') ?? '');
  const [energy, setEnergy] = useState<'' | Level>('');
  const [batch, setBatch] = useState<RecommendationBatch | null>(null);
  const latest = useQuery({ queryKey: qk.recommendationsLatest, queryFn: recommendationApi.latest });

  const generate = useMutation({
    mutationFn: () => recommendationApi.generate({ availableMinutes: minutes ? Number(minutes) : undefined, energy: energy || undefined }),
    onSuccess: (b) => (setBatch(b), void qc.invalidateQueries({ queryKey: qk.nextAction })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  // A "use this time" link arrives with minutes preset: generate immediately.
  useEffect(() => {
    if (params.get('minutes')) generate.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accept = useApiMutation({ mutationFn: (id: string) => recommendationApi.accept(id), successMessage: 'Scheduled on your calendar', onSuccess: () => void generate.mutate() });
  const dismiss = useApiMutation({ mutationFn: (id: string) => recommendationApi.dismiss(id), successMessage: 'Dismissed', onSuccess: () => void generate.mutate() });

  const shown = batch ?? latest.data ?? null;
  const validMinutes = !minutes || (/^\d+$/.test(minutes) && Number(minutes) >= 5 && Number(minutes) <= 720);

  return (
    <>
      <PageHeader title="Smart recommendations" description="Open tasks ranked against your real free time, your energy and your own history — with every reason shown." />

      <Card className="mb-6">
        <CardContent className="p-5">
          <form
            className="flex flex-wrap items-end gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (validMinutes) generate.mutate();
            }}
          >
            <Field label="I have (minutes)" hint="Optional — leave empty to use your calendar" error={!validMinutes ? 'Enter 5 to 720' : undefined}>
              {(p) => <Input {...p} className="w-44" inputMode="numeric" placeholder="e.g. 40" value={minutes} onChange={(e) => setMinutes(e.target.value)} />}
            </Field>
            <Field label="My energy right now" hint="Optional — overrides what is logged">
              {(p) => (
                <Select {...p} className="w-44" value={energy} onChange={(e) => setEnergy(e.target.value as '' | Level)}>
                  <option value="">Use logged / expected</option>
                  {LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {levelLabel(l)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button type="submit" variant="primary" disabled={!validMinutes} loading={generate.isPending}>
              <Sparkles className="size-4" /> Recommend
            </Button>
          </form>
        </CardContent>
      </Card>

      {generate.isPending && !shown ? (
        <LoadingState label="Ranking your tasks…" />
      ) : latest.isError && !shown ? (
        <ErrorState error={latest.error} />
      ) : !shown || (!shown.generatedAt && shown.recommendations.length === 0 && shown.excluded.length === 0) ? (
        <EmptyState icon={Sparkles} title="Ask for a recommendation" description="Tell us how many minutes you have, or just press Recommend to use your calendar's free windows." />
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3 text-[13px] text-fg-secondary">
            <Badge tone={shown.userState.source === 'LOGGED' ? 'success' : shown.userState.source === 'UNKNOWN' ? 'warning' : 'info'}>
              {shown.userState.source === 'UNKNOWN' ? 'Energy unknown' : `Energy ${shown.userState.energy?.toFixed(1)}/5 · ${shown.userState.source.toLowerCase()}`}
            </Badge>
            {shown.userState.source === 'UNKNOWN' && (
              <span>
                Log how you feel on the <Link href="/energy" className="text-primary hover:underline">Energy</Link> page for better matches.
              </span>
            )}
            {shown.usedDeclaredTime && (
              <span className="inline-flex items-center gap-1.5 text-warning">
                <Info className="size-3.5" aria-hidden /> Your calendar showed no free time, so the minutes you entered were trusted at reduced confidence.
              </span>
            )}
          </div>

          {shown.recommendations.length === 0 ? (
            <EmptyState icon={Sparkles} title="Nothing fits right now" description="Every open task was ruled out — see the reasons below." />
          ) : (
            <div className="space-y-4">
              {shown.recommendations.map((r, i) => (
                <RecommendationCard
                  key={r.id}
                  rec={r}
                  tz={tz}
                  use24h={use24h}
                  rank={i + 1}
                  defaultOpen={i === 0}
                  actions={
                    <div className="flex shrink-0 gap-2">
                      <Button variant="primary" size="sm" loading={accept.isPending && accept.variables === r.id} onClick={() => accept.mutate(r.id)}>
                        <Check className="size-4" /> Schedule it
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Dismiss ${r.title}`} onClick={() => dismiss.mutate(r.id)}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  }
                />
              ))}
            </div>
          )}

          {shown.excluded.length > 0 && (
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Not recommended</CardTitle>
                  <CardDescription>Open tasks that were considered and ruled out, and why.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="divide-y divide-border">
                  {shown.excluded.map((e) => (
                    <li key={e.taskId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm first:pt-0 last:pb-0">
                      <Link href={`/tasks/${e.taskId}`} className="text-fg hover:text-primary">
                        {e.title}
                      </Link>
                      <span className="text-[13px] text-fg-muted">{e.reason}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </>
  );
}

export function RecommendationsView() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}
