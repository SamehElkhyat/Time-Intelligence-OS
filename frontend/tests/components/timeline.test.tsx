import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Timeline } from '@/components/app/timeline';
import { TooltipProvider } from '@/components/ui/overlay';
import type { AvailabilityDay, PlannedBlock } from '@/types';

const DAY_START = Date.UTC(2026, 2, 2, 0, 0);
const at = (h: number, m = 0) => new Date(DAY_START + (h * 60 + m) * 60_000).toISOString();

const block = (over: Partial<PlannedBlock> & { id: string; title: string; start: string; end: string }): PlannedBlock => ({
  kind: 'ACTIVITY',
  categoryKey: 'work',
  categoryName: 'Work',
  color: '#b5f34d',
  isFixed: false,
  done: false,
  status: 'PLANNED',
  actualDurationSec: 0,
  scheduleEventId: null,
  taskId: null,
  ...over,
});

function day(over: Partial<AvailabilityDay> = {}, hours = 24): AvailabilityDay {
  return {
    date: '2026-03-02',
    timezone: 'UTC',
    range: { start: at(0), end: new Date(DAY_START + hours * 3_600_000).toISOString() },
    now: at(10, 30),
    isToday: true,
    activeHours: [{ start: at(8), end: at(18) }],
    hasExplicitAvailability: true,
    windows: [],
    conflicts: [],
    strip: [],
    blocks: [],
    summary: { freeSec: 0, highConfidenceFreeSec: 0, fragmentSec: 0, busyFutureSec: 0, bufferSec: 0, plannedSec: 0, trackedSec: 0, plannedUntrackedSec: 0, unknownSec: 0, conflictCount: 0 },
    ...over,
  };
}

function setup(d: AvailabilityDay, overrides: { onSelect?: () => void; onReschedule?: (...a: unknown[]) => void } = {}) {
  const onSelect = overrides.onSelect ?? vi.fn();
  const onReschedule = overrides.onReschedule ?? vi.fn();
  render(
    <TooltipProvider>
      <Timeline day={d} tz="UTC" use24h scale={60} onSelect={onSelect} onReschedule={onReschedule} />
    </TooltipProvider>,
  );
  return { onSelect, onReschedule };
}

describe('Timeline', () => {
  it('positions blocks by real elapsed time (60 px per hour)', () => {
    setup(day({ blocks: [block({ id: 'a', title: 'Deep work', start: at(9), end: at(11) })] }));
    const el = screen.getByRole('button', { name: /Deep work/ });
    expect(el).toHaveStyle({ top: '540px', height: '120px' });
  });

  it('draws a 23-hour spring-forward day with 23 hour rows, not 24', () => {
    setup(day({}, 23));
    const labels = screen.getAllByText(/^\d\d:00$/);
    expect(labels).toHaveLength(23);
  });

  it('marks conflicting blocks and shows overlapping blocks side by side', () => {
    const a = block({ id: 'a', title: 'Stand-up', start: at(9), end: at(10), isFixed: true });
    const b = block({ id: 'b', title: 'Client call', start: at(9, 30), end: at(10, 30), isFixed: true });
    setup(day({ blocks: [a, b], conflicts: [{ aId: 'a', aTitle: 'Stand-up', bId: 'b', bTitle: 'Client call', start: at(9, 30), end: at(10), overlapSec: 1800, severity: 'HARD' }] }));
    const first = screen.getByRole('button', { name: /Stand-up/ });
    const second = screen.getByRole('button', { name: /Client call/ });
    expect(first).toHaveAccessibleName(/conflicts with another commitment/);
    expect(second).toHaveAccessibleName(/conflicts with another commitment/);
    expect(first.style.width).toBe(second.style.width); // two lanes, equal width
    expect(first.style.left).not.toBe(second.style.left);
  });

  it('shows bookable free windows with their duration and confidence', () => {
    setup(day({ windows: [{ start: at(11), end: at(12), durationSec: 3600, confidenceScore: 90, confidence: 'HIGH', factors: [], precededBy: null, followedBy: null }] }));
    expect(screen.getByText(/1h free · high/)).toBeInTheDocument();
  });

  it('selecting a block reports it', async () => {
    const { onSelect } = setup(day({ blocks: [block({ id: 'a', title: 'Planning', start: at(9), end: at(10) })] }));
    await userEvent.setup().click(screen.getByRole('button', { name: /Planning/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  describe('keyboard rescheduling (the accessible alternative to dragging)', () => {
    const planned = block({ id: 'a', title: 'Writing', start: at(9), end: at(10) });

    it('Alt+ArrowDown moves a block 15 minutes later, Shift makes it 5', () => {
      const { onReschedule } = setup(day({ blocks: [planned] }));
      const el = screen.getByRole('button', { name: /Writing/ });
      fireEvent.keyDown(el, { key: 'ArrowDown', altKey: true });
      expect(onReschedule).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a' }), new Date(at(9, 15)), new Date(at(10, 15)));
      fireEvent.keyDown(el, { key: 'ArrowUp', altKey: true, shiftKey: true });
      expect(onReschedule).toHaveBeenLastCalledWith(expect.anything(), new Date(at(8, 55)), new Date(at(9, 55)));
    });

    it('Alt+Ctrl+ArrowDown resizes instead of moving', () => {
      const { onReschedule } = setup(day({ blocks: [planned] }));
      fireEvent.keyDown(screen.getByRole('button', { name: /Writing/ }), { key: 'ArrowDown', altKey: true, ctrlKey: true });
      expect(onReschedule).toHaveBeenCalledWith(expect.anything(), new Date(at(9)), new Date(at(10, 15)));
    });

    it('does not move past the start of the day', () => {
      const early = block({ id: 'e', title: 'Early', start: at(0, 5), end: at(1, 5) });
      const { onReschedule } = setup(day({ blocks: [early] }));
      fireEvent.keyDown(screen.getByRole('button', { name: /Early/ }), { key: 'ArrowUp', altKey: true });
      expect(onReschedule).toHaveBeenCalledWith(expect.anything(), new Date(at(0)), new Date(at(1)));
    });

    it.each([
      ['fixed commitments', block({ id: 'f', title: 'Exam', start: at(9), end: at(10), isFixed: true })],
      ['completed activities', block({ id: 'd', title: 'Done thing', start: at(9), end: at(10), done: true, status: 'COMPLETED' })],
      ['recurring occurrences', block({ id: 'r:2026-03-02', title: 'Stand-up', start: at(9), end: at(10), kind: 'RECURRING' })],
    ])('never moves %s', (_label, b) => {
      const { onReschedule } = setup(day({ blocks: [b] }));
      fireEvent.keyDown(screen.getByRole('button', { name: new RegExp(b.title) }), { key: 'ArrowDown', altKey: true });
      expect(onReschedule).not.toHaveBeenCalled();
    });

    it('Enter opens the block', () => {
      const { onSelect } = setup(day({ blocks: [planned] }));
      fireEvent.keyDown(screen.getByRole('button', { name: /Writing/ }), { key: 'Enter' });
      expect(onSelect).toHaveBeenCalled();
    });
  });

  it('only movable blocks expose a resize handle', () => {
    setup(day({ blocks: [block({ id: 'm', title: 'Movable', start: at(9), end: at(10) }), block({ id: 'x', title: 'Locked', start: at(12), end: at(13), isFixed: true })] }));
    const movable = screen.getByRole('button', { name: /Movable/ });
    const locked = screen.getByRole('button', { name: /Locked/ });
    expect(within(movable).queryByRole('presentation', { hidden: true }) ?? movable.querySelector('.cursor-ns-resize')).toBeTruthy();
    expect(locked.querySelector('.cursor-ns-resize')).toBeNull();
  });
});
