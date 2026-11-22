'use client';

import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FileBarChart } from 'lucide-react';
import { useState } from 'react';
import { MetricCard, PageHeader } from '@/components/app/primitives';
import { EmptyState, ErrorState, LoadingState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/overlay';
import dynamic from 'next/dynamic';
import { SkeletonCard } from '@/components/app/states';
import { qk } from '@/lib/query-keys';
import { addDays, fmtDateShort, fmtDuration, fmtMonth, startOfWeek, todayIn } from '@/lib/time';
import { useAuth } from '@/providers/auth-provider';
import { analyticsApi } from '@/services';
import { toSeries } from '../analytics/analytics-view';
import type { Report } from '@/types';

const TrendChart = dynamic(() => import('@/components/app/charts').then((m) => m.TrendChart), { ssr: false, loading: () => <SkeletonCard lines={5} /> });
const CategoryDonut = dynamic(() => import('@/components/app/charts').then((m) => m.CategoryDonut), { ssr: false, loading: () => <SkeletonCard lines={5} /> });

const LABELS: Record<string, string> = {
  trackedSec: 'Tracked time',
  productiveSec: 'Productive time',
  focusSec: 'Focus time',
  leakageSec: 'Unplanned gaps',
  deepWorkSessions: 'Deep-work sessions',
  completedActivities: 'Completed activities',
  completedTasks: 'Completed tasks',
};

function ReportBody({ report }: { report: Report }) {
  const t = report.summary.totals;
  const series = toSeries(report.summary);
  return (
    <div className="space-y-6">
      {!report.isComplete && <p className="rounded-lg border border-info/25 bg-info-soft px-4 py-2.5 text-[13px] text-info">This period is still in progress, so figures will keep changing.</p>}
      {t.activeDays === 0 ? (
        <EmptyState icon={FileBarChart} title="Nothing was tracked in this period" description="Reports summarise tracked time. Pick another period, or start tracking." />
      ) : (
        <>
          <Card className="border-primary/20">
            <CardHeader>
              <CardTitle>Highlights</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm leading-relaxed text-fg-secondary">
                {report.highlights.map((h) => (
                  <li key={h} className="flex gap-2.5">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" /> {h}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <section aria-label="Compared with the previous period" className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {report.changes.slice(0, 4).map((c) => (
              <MetricCard
                key={c.metric}
                label={LABELS[c.metric] ?? c.metric}
                value={c.metric.endsWith('Sec') ? fmtDuration(c.current) : c.current}
                accent={c.metric === 'productiveSec'}
                delta={{ pct: c.changePct, inverse: c.metric === 'leakageSec' }}
                hint={<Tooltip content="Previous period"><span>was {c.metric.endsWith('Sec') ? fmtDuration(c.previous) : c.previous}</span></Tooltip>}
              />
            ))}
          </section>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Daily productive hours</CardTitle>
              </CardHeader>
              <CardContent>
                <TrendChart data={series} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Time by category</CardTitle>
              </CardHeader>
              <CardContent>
                <CategoryDonut data={report.summary.categories.map((c) => ({ name: c.name, color: c.color, value: c.trackedSec }))} />
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export function ReportsView() {
  const { tz, preference } = useAuth();
  const today = todayIn(tz);
  const [weekDate, setWeekDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const week = useQuery({ queryKey: qk.weeklyReport(weekDate), queryFn: () => analyticsApi.weekly(weekDate) });
  const mon = useQuery({ queryKey: qk.monthlyReport(month), queryFn: () => analyticsApi.monthly(month) });

  const shiftMonth = (n: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const weekStart = startOfWeek(weekDate, preference.weekStartsOn);

  return (
    <>
      <PageHeader title="Reports" description="Weekly and monthly summaries, compared with the period before." />
      <Tabs defaultValue="weekly">
        <TabsList aria-label="Report type">
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
        </TabsList>
        <TabsContent value="weekly" className="mt-5 outline-none">
          <Nav label={`${fmtDateShort(weekStart)} – ${fmtDateShort(addDays(weekStart, 6))}`} onPrev={() => setWeekDate(addDays(weekDate, -7))} onNext={() => setWeekDate(addDays(weekDate, 7))} nextDisabled={addDays(weekStart, 7) > today} />
          {week.isLoading ? <LoadingState /> : week.isError || !week.data ? <ErrorState error={week.error} onRetry={() => void week.refetch()} /> : <ReportBody report={week.data} />}
        </TabsContent>
        <TabsContent value="monthly" className="mt-5 outline-none">
          <Nav label={fmtMonth(month)} onPrev={() => shiftMonth(-1)} onNext={() => shiftMonth(1)} nextDisabled={month >= today.slice(0, 7)} />
          {mon.isLoading ? <LoadingState /> : mon.isError || !mon.data ? <ErrorState error={mon.error} onRetry={() => void mon.refetch()} /> : <ReportBody report={mon.data} />}
        </TabsContent>
      </Tabs>
    </>
  );
}

function Nav({ label, onPrev, onNext, nextDisabled }: { label: string; onPrev: () => void; onNext: () => void; nextDisabled: boolean }) {
  return (
    <div className="mb-5 flex items-center gap-2">
      <Button variant="outline" size="icon" aria-label="Previous period" onClick={onPrev}>
        <ChevronLeft className="size-4" />
      </Button>
      <span className="min-w-44 text-center text-sm font-medium text-fg">{label}</span>
      <Button variant="outline" size="icon" aria-label="Next period" disabled={nextDisabled} onClick={onNext}>
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
