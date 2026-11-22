'use client';

import { useQuery } from '@tanstack/react-query';
import { BarChart3 } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { MetricCard, PageHeader } from '@/components/app/primitives';
import { EmptyState, ErrorState, SkeletonCard } from '@/components/app/states';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Segmented } from '@/components/ui/tabs';
import { qk } from '@/lib/query-keys';
import { addDays, fmtDateShort, fmtDuration, todayIn } from '@/lib/time';
import { useAuth } from '@/providers/auth-provider';
import { analyticsApi } from '@/services';
import type { AnalyticsSummary } from '@/types';

const chart = (name: 'TrendChart' | 'PlannedActualChart' | 'CategoryDonut' | 'FocusChart' | 'UtilisationHeatmap' | 'HourlyBars') =>
  dynamic(() => import('@/components/app/charts').then((m) => m[name] as never), { ssr: false, loading: () => <SkeletonCard lines={6} /> }) as never;
const TrendChart = chart('TrendChart') as typeof import('@/components/app/charts').TrendChart;
const PlannedActualChart = chart('PlannedActualChart') as typeof import('@/components/app/charts').PlannedActualChart;
const CategoryDonut = chart('CategoryDonut') as typeof import('@/components/app/charts').CategoryDonut;
const FocusChart = chart('FocusChart') as typeof import('@/components/app/charts').FocusChart;
const UtilisationHeatmap = chart('UtilisationHeatmap') as typeof import('@/components/app/charts').UtilisationHeatmap;
const HourlyBars = chart('HourlyBars') as typeof import('@/components/app/charts').HourlyBars;

type Period = '7' | '14' | '30' | '90';

export function toSeries(s: AnalyticsSummary) {
  return s.days.map((d) => ({ label: fmtDateShort(d.date), tracked: d.trackedSec, productive: d.productiveSec, focus: d.focusSec, planned: d.plannedSec }));
}

/** Seven-day-or-longer view of everything that was measured. */
export function AnalyticsView() {
  const { tz, preference } = useAuth();
  const [period, setPeriod] = useState<Period>('14');
  const to = todayIn(tz);
  const from = addDays(to, -(Number(period) - 1));
  const summary = useQuery({ queryKey: qk.analyticsSummary(from, to), queryFn: () => analyticsApi.summary(from, to) });
  const data = summary.data;
  const series = useMemo(() => (data ? toSeries(data) : []), [data]);

  return (
    <>
      <PageHeader
        title="Productivity analytics"
        description="Measured from your tracked time and plans. Where something cannot be measured, it says so instead of showing a number."
        actions={
          <Segmented
            label="Period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: '7', label: '7 days' },
              { value: '14', label: '14 days' },
              { value: '30', label: '30 days' },
              { value: '90', label: '90 days' },
            ]}
          />
        }
      />
      {summary.isLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <SkeletonCard key={i} lines={2} />
          ))}
        </div>
      ) : summary.isError || !data ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : data.totals.activeDays === 0 ? (
        <EmptyState icon={BarChart3} title="No tracked time in this period" description="Analytics appear once you track activities. Start a timer, or add a manual entry for time you already spent." />
      ) : (
        <div className="space-y-6">
          <Kpis data={data} />
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Productive vs. tracked hours</CardTitle>
                  <CardDescription>Productive = time in productive categories. Rest and leisure are tracked but never counted as waste.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <TrendChart data={series} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Planned vs. actual</CardTitle>
                  <CardDescription>What you intended against what was tracked.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <PlannedActualChart data={series} />
              </CardContent>
            </Card>
          </div>
          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Where the time went</CardTitle>
              </CardHeader>
              <CardContent>
                <CategoryDonut data={data.categories.map((c) => ({ name: c.name, color: c.color, value: c.trackedSec }))} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Focus time</CardTitle>
                  <CardDescription>Uninterrupted productive blocks of 25+ minutes. Lime bars reached your daily goal.</CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <FocusChart data={series} goalHours={preference.dailyFocusGoalMinutes / 60} />
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Time utilisation heatmap</CardTitle>
                <CardDescription>Average tracked time per weekday and hour. Darker means busier. Your productive patterns show up here.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <UtilisationHeatmap cells={data.heatmap} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Planned vs. tracked by category</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {data.categories
                  .filter((c) => c.trackedSec > 0 || c.plannedSec > 0)
                  .map((c) => {
                    const max = Math.max(1, ...data.categories.map((x) => Math.max(x.trackedSec, x.plannedSec)));
                    return (
                      <li key={c.categoryId} className="grid grid-cols-[120px_1fr_150px] items-center gap-3 text-[13px]">
                        <span className="inline-flex items-center gap-2 text-fg-secondary">
                          <span aria-hidden className="size-2 rounded-full" style={{ background: c.color }} />
                          {c.name}
                        </span>
                        <div className="space-y-1">
                          <div className="h-1.5 rounded-full bg-surface-elevated"><div className="h-full rounded-full" style={{ width: `${(c.trackedSec / max) * 100}%`, background: c.color }} /></div>
                          <div className="h-1.5 rounded-full bg-surface-elevated"><div className="h-full rounded-full opacity-40" style={{ width: `${(c.plannedSec / max) * 100}%`, background: c.color }} /></div>
                        </div>
                        <span className="tabular text-right text-fg-muted">
                          <span className="text-fg">{fmtDuration(c.trackedSec)}</span> / {fmtDuration(c.plannedSec)} planned
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

export function Kpis({ data }: { data: AnalyticsSummary }) {
  const t = data.totals;
  const none = (v: number | null, suffix = '%') => (v === null ? '—' : `${v}${suffix}`);
  return (
    <section aria-label="Key figures" className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <MetricCard label="Productive time" value={fmtDuration(t.productiveSec)} accent hint={`${t.activeDays} tracked day${t.activeDays === 1 ? '' : 's'}`} />
      <MetricCard label="Focus time" value={fmtDuration(t.focusSec)} hint={`${t.deepWorkSessions} deep-work session${t.deepWorkSessions === 1 ? '' : 's'}`} />
      <MetricCard label="Avg. productivity score" value={none(t.avgProductivityScore, '')} hint={t.avgProductivityScore === null ? 'not enough data' : 'out of 100'} />
      <MetricCard label="Schedule adherence" value={none(t.avgAdherencePct)} hint="planned time actually tracked" />
      <MetricCard label="Estimation accuracy" value={none(t.avgEstimationAccuracyPct)} hint="estimate vs. actual" />
      <MetricCard label="Task completion" value={none(t.taskCompletionRatePct)} hint={`${t.completedTasks} completed`} />
      <MetricCard label="Avg. session" value={t.avgSessionSec === null ? '—' : fmtDuration(t.avgSessionSec)} hint="per tracked session" />
      <MetricCard label="Unplanned gaps" value={fmtDuration(t.leakageSec)} hint={t.unknownSec > 0 ? `${fmtDuration(t.unknownSec)} unknown` : 'none unknown'} />
    </section>
  );
}

export { HourlyBars };
