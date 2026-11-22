'use client';

import { useQuery } from '@tanstack/react-query';
import { CircleHelp, Droplets, Lightbulb, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/app/primitives';
import { EmptyState, ErrorState, LoadingState } from '@/components/app/states';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, Progress } from '@/components/ui/card';
import { Segmented } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/overlay';
import { qk } from '@/lib/query-keys';
import { addDays, fmtDuration, todayIn } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { analyticsApi } from '@/services';

const SEVERITY = { HIGH: 'danger', MEDIUM: 'warning', LOW: 'info' } as const;
const SUFFICIENCY: Record<string, { label: string; tone: 'neutral' | 'warning' | 'info' | 'success' }> = {
  INSUFFICIENT: { label: 'Not enough data', tone: 'neutral' },
  LOW: { label: 'Early signal', tone: 'warning' },
  MEDIUM: { label: 'Fairly reliable', tone: 'info' },
  HIGH: { label: 'Reliable', tone: 'success' },
};

export function InsightsView() {
  const { tz } = useAuth();
  const [days, setDays] = useState<'7' | '14' | '30'>('7');
  const to = todayIn(tz);
  const from = addDays(to, -(Number(days) - 1));
  const leakage = useQuery({ queryKey: qk.leakage(from, to), queryFn: () => analyticsApi.leakage(from, to) });
  const patterns = useQuery({ queryKey: qk.patterns, queryFn: analyticsApi.patterns });

  return (
    <>
      <PageHeader title="Insights" description="Where time leaks, and what your own history suggests. Every finding shows the evidence behind it — and predictions are estimates, never facts." />

      <section aria-labelledby="leak-h" className="mb-10">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="leak-h" className="flex items-center gap-2 text-lg font-semibold text-fg">
            <Droplets className="size-5 text-primary" aria-hidden /> Time leakage
          </h2>
          <Segmented label="Period" value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' }]} />
        </div>
        {leakage.isLoading ? (
          <LoadingState />
        ) : leakage.isError || !leakage.data ? (
          <ErrorState error={leakage.error} onRetry={() => void leakage.refetch()} />
        ) : (
          <>
            <Card className="mb-4">
              <CardContent className="grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-5">
                <Bucket label="Productive" value={leakage.data.totals.productiveSec} tone="text-primary" note="tracked work" />
                <Bucket label="Rest & leisure" value={leakage.data.totals.restSec + leakage.data.totals.leisureSec} tone="text-info" note="never counted as waste" />
                <Bucket label="Unplanned gaps" value={leakage.data.totals.unplannedGapSec} tone="text-warning" note="the only 'leakage'" />
                <Bucket label="Planned, not tracked" value={leakage.data.totals.plannedUntrackedSec} tone="text-fg-secondary" note="may or may not have happened" />
                <Bucket label="Unknown" value={leakage.data.totals.unknownSec} tone="text-fg-secondary" note="no plan, no data" />
              </CardContent>
            </Card>
            {leakage.data.insights.length === 0 ? (
              <EmptyState icon={Lightbulb} title={leakage.data.daysWithData === 0 ? 'No tracked days in this period' : 'No leakage patterns found'} description={leakage.data.daysWithData === 0 ? 'Track some activities and findings appear here.' : 'Your tracked time looks clean over this period. Nothing stands out.'} />
            ) : (
              <ul className="space-y-3">
                {leakage.data.insights.map((i) => (
                  <li key={i.type}>
                    <Card>
                      <CardContent className="p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="text-[15px] font-semibold text-fg">{i.title}</h3>
                          <div className="flex items-center gap-2">
                            {i.impactSec !== null && <span className="tabular text-[13px] text-fg-secondary">{fmtDuration(i.impactSec)} affected</span>}
                            <Badge tone={SEVERITY[i.severity as keyof typeof SEVERITY]}>{i.severity.toLowerCase()}</Badge>
                          </div>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{i.explanation}</p>
                        {i.evidence.length > 0 && (
                          <dl className="mt-3 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
                            {i.evidence.map((e) => (
                              <div key={e.label} className="flex justify-between gap-3 border-b border-border py-1">
                                <dt className="text-fg-muted">{e.label}</dt>
                                <dd className="text-right text-fg-secondary">{e.value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        <p className="mt-3 flex gap-2 text-sm text-fg">
                          <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden /> {i.suggestion}
                        </p>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="pat-h">
        <h2 id="pat-h" className="mb-1 flex items-center gap-2 text-lg font-semibold text-fg">
          <TrendingUp className="size-5 text-primary" aria-hidden /> Your patterns
        </h2>
        <p className="mb-4 text-[13px] text-fg-secondary">Descriptive statistics over your last 8 weeks (a baseline method — no black-box model). Each card states how much data it rests on.</p>
        {patterns.isLoading ? (
          <LoadingState />
        ) : patterns.isError || !patterns.data ? (
          <ErrorState error={patterns.error} onRetry={() => void patterns.refetch()} />
        ) : (
          <div className="space-y-4">
            <Card className="border-primary/20">
              <CardHeader>
                <div>
                  <CardTitle>Expected today</CardTitle>
                  <CardDescription>{patterns.data.forecast.basis}</CardDescription>
                </div>
                <SufficiencyBadge value={patterns.data.forecast.sufficiency} confidence={patterns.data.forecast.confidence} />
              </CardHeader>
              <CardContent>
                {patterns.data.forecast.expectedProductiveSec === null ? (
                  <p className="text-sm text-fg-secondary">No estimate yet — it needs more tracked days.</p>
                ) : (
                  <p className="tabular text-3xl font-semibold text-primary">
                    {fmtDuration(patterns.data.forecast.expectedProductiveSec)}
                    <span className="ml-3 text-sm font-normal text-fg-muted">
                      typical range {fmtDuration(patterns.data.forecast.lowSec)} – {fmtDuration(patterns.data.forecast.highSec)} productive
                    </span>
                  </p>
                )}
              </CardContent>
            </Card>
            <div className="grid gap-4 md:grid-cols-2">
              {patterns.data.insights.map((p) => (
                <Card key={p.key} className={cn(p.sufficiency === 'INSUFFICIENT' && 'opacity-75')}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-sm font-semibold text-fg">{p.title}</h3>
                      <SufficiencyBadge value={p.sufficiency} confidence={p.confidence} />
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-fg-secondary">{p.statement}</p>
                    <div className="mt-3 flex items-center gap-3">
                      <Progress className="flex-1" value={p.confidence} tone={p.confidence >= 70 ? 'primary' : p.confidence >= 40 ? 'info' : 'warning'} label={`Confidence ${p.confidence}%`} />
                      <span className="tabular text-xs text-fg-muted">{p.sampleSize} {p.sampleUnit}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}

function SufficiencyBadge({ value, confidence }: { value: string; confidence: number }) {
  const s = SUFFICIENCY[value] ?? SUFFICIENCY.INSUFFICIENT!;
  return (
    <Tooltip content="Data sufficiency: how much history this insight is built from. Confidence: how strongly that history supports it.">
      <Badge tone={s.tone} className="cursor-help">
        {s.label} {value !== 'INSUFFICIENT' && <span className="tabular opacity-70">· {confidence}%</span>}
        <CircleHelp className="size-3 opacity-60" aria-hidden />
      </Badge>
    </Tooltip>
  );
}

function Bucket({ label, value, tone, note }: { label: string; value: number; tone: string; note: string }) {
  return (
    <div>
      <div className="text-[13px] text-fg-secondary">{label}</div>
      <div className={cn('tabular mt-1 text-2xl font-semibold', tone)}>{fmtDuration(value)}</div>
      <div className="mt-0.5 text-xs text-fg-muted">{note}</div>
    </div>
  );
}
