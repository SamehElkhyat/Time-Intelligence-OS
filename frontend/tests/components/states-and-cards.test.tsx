import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AvailabilityWindowCard, ConfidenceBadge, TaskCard } from '@/components/app/cards';
import { ConfirmationDialog, DataTable, MetricCard } from '@/components/app/primitives';
import { EmptyState, ErrorState, LoadingState, QueryBoundary } from '@/components/app/states';
import { ApiError } from '@/lib/api/client';
import type { Task } from '@/types';
import { Providers } from './test-utils';
import { Inbox } from 'lucide-react';

const NOW = Date.UTC(2026, 2, 2, 12, 0);
const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  title: 'Prepare report',
  description: null,
  estimatedDurationSec: 1800,
  priority: 'HIGH',
  deadline: new Date(NOW + 3 * 3_600_000).toISOString(),
  category: { id: 'c', key: 'work', name: 'Work', color: '#b5f34d', timeClass: 'PRODUCTIVE' },
  energyRequired: 'MODERATE',
  focusRequired: 'HIGH',
  complexity: 3,
  status: 'TODO',
  tags: [],
  preferredTimeOfDay: 'ANY',
  subtasks: [],
  dependsOn: [],
  blocks: [],
  isBlocked: false,
  scheduledBlocks: [],
  trackedSec: 0,
  recurrence: null,
  seriesId: null,
  occurrenceDate: null,
  completedAt: null,
  createdAt: new Date(NOW - 86_400_000).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
  ...over,
});
const wrap = (ui: React.ReactElement) => render(<Providers>{ui}</Providers>);

describe('TaskCard interactions', () => {
  it('completes a task from its checkbox', async () => {
    const onComplete = vi.fn();
    wrap(<TaskCard task={task()} tz="UTC" use24h now={NOW} onComplete={onComplete} />);
    await userEvent.setup().click(screen.getByRole('checkbox', { name: 'Complete Prepare report' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('cannot complete a blocked task and says what it is waiting on', async () => {
    const onComplete = vi.fn();
    wrap(<TaskCard task={task({ isBlocked: true, dependsOn: [{ id: 'd', title: 'Collect data', status: 'TODO' }] })} tz="UTC" use24h now={NOW} onComplete={onComplete} />);
    const box = screen.getByRole('checkbox');
    expect(box).toBeDisabled();
    await userEvent.setup().click(box);
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByText('Blocked')).toBeInTheDocument();
  });

  it('flags overdue tasks in words, not just colour', () => {
    wrap(<TaskCard task={task({ deadline: new Date(NOW - 2 * 3_600_000).toISOString() })} tz="UTC" use24h now={NOW} onComplete={() => {}} />);
    expect(screen.getByText(/Overdue 2 h ago/)).toBeInTheDocument();
  });

  it('shows subtask progress and a completed state', () => {
    wrap(<TaskCard task={task({ status: 'COMPLETED', subtasks: [{ id: 's1', title: 'a', isDone: true, position: 0 }, { id: 's2', title: 'b', isDone: false, position: 1 }] })} tz="UTC" use24h now={NOW} />);
    expect(screen.getByText('1/2 subtasks')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Prepare report is completed' })).toBeChecked();
  });

  it('offers scheduling only while there is no upcoming work block', async () => {
    const onSchedule = vi.fn();
    const { rerender } = wrap(<TaskCard task={task()} tz="UTC" use24h now={NOW} onSchedule={onSchedule} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /Schedule/ }));
    expect(onSchedule).toHaveBeenCalled();
    rerender(
      <Providers>
        <TaskCard task={task({ scheduledBlocks: [{ activityId: 'a', plannedStart: new Date(NOW + 3_600_000).toISOString(), plannedEnd: new Date(NOW + 7_200_000).toISOString(), status: 'PLANNED', actualDurationSec: 0 }] })} tz="UTC" use24h now={NOW} onSchedule={onSchedule} />
      </Providers>,
    );
    expect(screen.queryByRole('button', { name: /Schedule/ })).not.toBeInTheDocument();
  });
});

describe('availability confidence is explicit', () => {
  it('names the confidence level and its score', () => {
    wrap(<ConfidenceBadge confidence="MEDIUM" score={62} />);
    expect(screen.getByText('Medium confidence')).toBeInTheDocument();
    expect(screen.getByText(/62/)).toBeInTheDocument();
  });

  it('renders a free window with its duration, neighbours and confidence', () => {
    wrap(
      <AvailabilityWindowCard
        tz="UTC"
        use24h
        window={{ start: '2026-03-02T10:30:00.000Z', end: '2026-03-02T11:00:00.000Z', durationSec: 1800, confidenceScore: 90, confidence: 'HIGH', factors: [], precededBy: 'Meeting', followedBy: 'Learning' }}
      />,
    );
    expect(screen.getByText('10:30 – 11:00')).toBeInTheDocument();
    expect(screen.getByText('30 min free')).toBeInTheDocument();
    expect(screen.getByText(/After “Meeting”/)).toBeInTheDocument();
    expect(screen.getByText(/before “Learning”/)).toBeInTheDocument();
    expect(screen.getByText('High confidence')).toBeInTheDocument();
  });
});

describe('API error states', () => {
  it('shows the server message, its reference id and a working retry', async () => {
    const onRetry = vi.fn();
    const error = new ApiError(500, { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong on our side.', requestId: 'req-42' }, 'x');
    wrap(<ErrorState error={error} onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong on our side.');
    expect(screen.getByText('Reference: req-42')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('includes field-level details for validation errors', () => {
    const error = new ApiError(400, { statusCode: 400, code: 'VALIDATION_ERROR', message: 'Some fields are invalid.', details: ['title must not be empty'] }, 'x');
    wrap(<ErrorState error={error} />);
    expect(screen.getByRole('alert')).toHaveTextContent('title must not be empty');
  });

  it('handles non-API errors without leaking internals', () => {
    wrap(<ErrorState error={undefined} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Please try again.');
  });
});

describe('QueryBoundary: loading → error → empty → content', () => {
  const q = (over: object) => ({ data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn(), ...over });
  const render_ = (query: ReturnType<typeof q>) =>
    wrap(
      <QueryBoundary query={query as never} isEmpty={(d: number[]) => d.length === 0} empty={<EmptyState icon={Inbox} title="Nothing here" />} skeleton={<LoadingState label="Loading things…" />}>
        {(d: number[]) => <ul>{d.map((n) => <li key={n}>item {n}</li>)}</ul>}
      </QueryBoundary>,
    );

  it('shows the skeleton while loading', () => {
    render_(q({ isLoading: true }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading things…');
  });
  it('shows the error with retry', async () => {
    const refetch = vi.fn();
    render_(q({ isError: true, error: new Error('boom'), refetch }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });
  it('shows the empty state for empty data and content otherwise', () => {
    const { unmount } = render_(q({ data: [] }));
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    unmount();
    render_(q({ data: [1, 2] }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });
});

describe('shared primitives', () => {
  it('MetricCard shows a delta only when there is a previous value, and colours it by direction', () => {
    const { rerender } = wrap(<MetricCard label="Productive" value="4h" delta={{ pct: 12 }} />);
    expect(screen.getByText('12%')).toBeInTheDocument();
    rerender(
      <Providers>
        <MetricCard label="Productive" value="4h" delta={{ pct: null }} />
      </Providers>,
    );
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it('DataTable is keyboard operable and labelled', async () => {
    const onRow = vi.fn();
    wrap(<DataTable caption="Tasks" columns={[{ key: 'n', header: 'Name', cell: (r: { n: string }) => r.n }]} rows={[{ n: 'Alpha' }, { n: 'Beta' }]} rowKey={(r) => r.n} onRowClick={onRow} />);
    expect(screen.getByRole('table', { name: 'Tasks' })).toBeInTheDocument();
    const row = screen.getByText('Beta').closest('tr')!;
    row.focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(onRow).toHaveBeenCalledWith({ n: 'Beta' });
  });

  it('ConfirmationDialog requires an explicit confirm and can be cancelled', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    wrap(<ConfirmationDialog open onOpenChange={onOpenChange} title="Delete it?" description="This cannot be undone." confirmLabel="Delete" onConfirm={onConfirm} />);
    const dialog = screen.getByRole('dialog', { name: 'Delete it?' });
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
