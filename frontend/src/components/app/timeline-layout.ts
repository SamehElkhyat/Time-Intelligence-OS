/** Pure layout helpers for the timeline (unit tested separately from the component). */

export interface LaneInput {
  id: string;
  start: number;
  end: number;
}
export interface LanePlacement {
  id: string;
  lane: number;
  lanes: number;
}

/**
 * Greedy interval colouring: blocks that overlap in time are placed side by side. Each cluster of
 * transitively-overlapping blocks gets its own lane count, so unrelated blocks keep full width.
 */
export function layoutLanes(blocks: LaneInput[]): LanePlacement[] {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const out: LanePlacement[] = [];
  let cluster: { block: LaneInput; lane: number }[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const c of cluster) out.push({ id: c.block.id, lane: c.lane, lanes });
    cluster = [];
    laneEnds = [];
  };

  for (const block of sorted) {
    if (block.start >= clusterEnd) {
      flush();
      clusterEnd = -Infinity;
    }
    let lane = laneEnds.findIndex((end) => end <= block.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(block.end);
    } else {
      laneEnds[lane] = block.end;
    }
    cluster.push({ block, lane });
    clusterEnd = Math.max(clusterEnd, block.end);
  }
  flush();
  return out;
}

/** Round minutes to the nearest multiple of `step`. */
export const snapMinutes = (minutes: number, step: number): number => Math.round(minutes / step) * step;

/** Pixel distance → whole minutes (snapped), for a given scale in pixels per hour. */
export const pixelsToMinutes = (px: number, pxPerHour: number, step = 5): number => snapMinutes((px / pxPerHour) * 60, step);

/** Keep a block of `lengthMs` fully inside [rangeStart, rangeEnd] while moving its start to `start`. */
export function clampStart(start: number, lengthMs: number, rangeStart: number, rangeEnd: number): number {
  return Math.min(Math.max(start, rangeStart), Math.max(rangeStart, rangeEnd - lengthMs));
}
