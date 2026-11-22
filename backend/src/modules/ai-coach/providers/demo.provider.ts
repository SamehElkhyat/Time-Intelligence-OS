import { formatDuration } from '@/common/time/time';
import { CoachProvider, ProviderRequest, ProviderResult } from './coach-provider';

export const DEMO_NOTICE =
  'Demo mode: no AI provider is configured, so these answers come from a deterministic rule-based engine over your real data — not from a language model. Set ANTHROPIC_API_KEY on the server for the live coach.';

type Intent = 'next_action' | 'yesterday' | 'time_spent' | 'find_slot' | 'improve' | 'weekly' | 'day_summary';

export function detectIntent(q: string): Intent {
  const s = q.toLowerCase();
  if (/(next|have|got)\s+\d+\s*(min|minutes|mins)/.test(s) || /what should i (do|work on)/.test(s)) return 'next_action';
  if (/yesterday|fail(ed)? to|why did i (not|fail)|didn'?t (complete|finish)/.test(s)) return 'yesterday';
  if (/weekly (report|summary)|summar(y|ise|ize) (of )?(my |the )?week|week(ly)? report/.test(s)) return 'weekly';
  if (/deep work|focus (session|block)|find (me )?(a )?(suitable |good )?(time|slot)|when (can|should) i/.test(s)) return 'find_slot';
  if (/analy[sz]e|improv|suggest|leak|waste|insight/.test(s)) return 'improve';
  if (/how (much|many)|spent|time on/.test(s)) return 'time_spent';
  return 'day_summary';
}

const minutesIn = (q: string, fallback: number): number => {
  const m = /(\d+)\s*(?:min|minutes|mins)/i.exec(q) ?? /(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hours?)/i.exec(q);
  if (!m) return fallback;
  const n = Number(m[1]);
  return /h/i.test(m[0]) && !/min/i.test(m[0]) ? Math.round(n * 60) : Math.round(n);
};

const dur = (min: number): string => formatDuration(min * 60);
// Tool results are JSON of a shape each tool documents; the demo engine only reads the fields it needs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/**
 * Deterministic stand-in used when no AI key is configured.
 *
 * It routes the question to the same authorized tools the live coach uses and writes the answer
 * from a fixed template. It cannot understand arbitrary language and it says so: every reply it
 * produces is flagged `isDemo` and is shown as a demo reply in the UI.
 */
export class DemoCoachProvider implements CoachProvider {
  readonly name = 'demo' as const;
  readonly isDemo = true;
  readonly model = null;

  async run(req: ProviderRequest): Promise<ProviderResult> {
    const question = req.history[req.history.length - 1]?.content ?? '';
    const result: ProviderResult = { text: '', toolCalls: [], inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, model: null };
    const call = async (name: string, input: Record<string, unknown> = {}): Promise<Json> => {
      const out = await req.tools.execute(req.ctx, name, input);
      result.toolCalls.push(out.log);
      return JSON.parse(out.content) as Json;
    };

    switch (detectIntent(question)) {
      case 'next_action': {
        const minutes = minutesIn(question, 40);
        const r = await call('recommend_tasks', { available_minutes: Math.min(720, Math.max(5, minutes)) });
        const top = (r.recommendations as Json[] | undefined)?.[0];
        if (!top) {
          const why = (r.notRecommended as Json[] | undefined)?.[0];
          result.text = `I could not find an open task that fits ${dur(minutes)}.${why ? ` For example, "${why.title}": ${why.why}` : ' You have no open tasks to recommend — add one and ask again.'}`;
        } else {
          result.text =
            `With ${dur(minutes)} available, the best fit is "${top.title}" (about ${dur(top.estimatedMin)}, score ${top.score}/100, confidence ${top.confidence}%).\n` +
            `${top.summary}\n` +
            `It fits ${top.window.start.slice(11)}–${top.window.end.slice(11)}. Open Smart Recommendations to accept it into your schedule.`;
        }
        break;
      }

      case 'yesterday': {
        const day = req.ctx.timezone ? await call('get_day_overview', { date: shiftDate(req.ctx.now, req.ctx.timezone, -1) }) : {};
        if (day.error) {
          result.text = `I could not load yesterday: ${day.error}`;
          break;
        }
        const lines = [`Yesterday (${day.date}): you planned ${dur(day.plannedMin)} and tracked ${dur(day.trackedMin)}.`];
        lines.push(`Completed ${day.completedActivities} of ${day.plannedActivities} planned activities and ${day.completedTasks} task(s).`);
        if (day.plannedButUntrackedMin > 0) lines.push(`${dur(day.plannedButUntrackedMin)} was planned but never tracked, so I cannot tell whether it happened.`);
        if (day.unplannedGapMin > 0) lines.push(`${dur(day.unplannedGapMin)} slipped away in unplanned gaps between activities.`);
        if (day.scheduleConflicts > 0) lines.push(`${day.scheduleConflicts} commitment(s) overlapped, which makes finishing everything unrealistic.`);
        if (day.plannedMin > 0 && day.trackedMin === 0) lines.push('Nothing was tracked, so any explanation would be a guess.');
        result.text = lines.join('\n');
        break;
      }

      case 'weekly':
      case 'time_spent': {
        const range = await weekRange(call, req);
        const s = await call('get_time_summary', range);
        if (s.error) {
          result.text = `I could not load that period: ${s.error}`;
          break;
        }
        const wanted = (s.categories as Json[]).find((c) => question.toLowerCase().includes(String(c.name).toLowerCase()));
        if (wanted) {
          result.text = `${range.from_date} to ${range.to_date}: you tracked ${dur(wanted.trackedMin)} on ${wanted.name} (planned ${dur(wanted.plannedMin)}).`;
        } else {
          const top = (s.categories as Json[]).filter((c) => c.trackedMin > 0).slice(0, 4).map((c) => `${c.name} ${dur(c.trackedMin)}`);
          result.text =
            `${range.from_date} to ${range.to_date}: ${dur(s.trackedMin)} tracked over ${s.daysWithTracking} day(s), ${dur(s.productiveMin)} productive, ${dur(s.focusMin)} focused.` +
            (top.length ? `\nBy category: ${top.join(', ')}.` : '') +
            (s.avgProductivityScore !== null ? `\nAverage productivity score: ${s.avgProductivityScore}/100.` : '') +
            (s.daysWithTracking === 0 ? '\nNothing was tracked in this period.' : '');
        }
        break;
      }

      case 'find_slot': {
        const minutes = minutesIn(question, 90);
        const r = await call('find_free_slots', { duration_minutes: Math.min(720, Math.max(5, minutes)), days: 3 });
        const slots = (r.slots as Json[] | undefined) ?? [];
        result.text = slots.length
          ? `Free slots for ${dur(minutes)}:\n` + slots.slice(0, 3).map((x) => `• ${x.date} ${x.start.slice(11)}–${x.end.slice(11)} (${String(x.confidence).toLowerCase()} confidence)`).join('\n')
          : `There is no free window of ${dur(minutes)} in the next 3 days. Try a shorter session or free up time.`;
        break;
      }

      case 'improve': {
        const [leak, patterns] = await Promise.all([call('get_leakage_insights'), call('get_productivity_patterns')]);
        const insights = (leak.insights as Json[] | undefined) ?? [];
        const lines: string[] = [];
        if (insights.length === 0) lines.push('No time-leakage patterns stand out in the last 7 days.');
        for (const i of insights.slice(0, 3)) lines.push(`• ${i.title}. ${i.suggestion}`);
        const useful = ((patterns.insights as Json[] | undefined) ?? []).find((p) => p.sufficiency !== 'INSUFFICIENT');
        if (useful) lines.push(`Pattern: ${useful.statement} (confidence ${useful.confidence}%, ${useful.sampleSize} ${useful.sampleUnit}).`);
        else lines.push('There is not enough history yet for personal patterns — keep tracking for a couple of weeks.');
        result.text = lines.join('\n');
        break;
      }

      default: {
        const d = await call('get_day_overview');
        if (d.error) {
          result.text = `I could not load your day: ${d.error}`;
          break;
        }
        const lines = [`${d.date}: ${dur(d.plannedMin)} planned, ${dur(d.trackedMin)} tracked, ${dur(d.bookableFreeMin)} of bookable free time left.`];
        if (d.currentTimer) lines.push(`Now tracking "${d.currentTimer.activity}" (${dur(d.currentTimer.elapsedMin)} so far).`);
        if (d.productivityScore !== null) lines.push(`Productivity score so far: ${d.productivityScore}/100; focus ${dur(d.focusMin)} of a ${dur(d.focusGoalMin)} goal.`);
        const next = (d.upcoming as Json[])[0];
        if (next) lines.push(`Next up: "${next.title}" at ${String(next.start).slice(11)}.`);
        if (d.overdueTasks > 0) lines.push(`${d.overdueTasks} task(s) are overdue.`);
        if (d.scheduleConflicts > 0) lines.push(`${d.scheduleConflicts} schedule conflict(s) need attention.`);
        result.text = lines.join('\n');
      }
    }
    return result;
  }
}

function shiftDate(now: number, tz: string, days: number): string {
  const d = new Date(now + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

async function weekRange(call: (n: string, i?: Record<string, unknown>) => Promise<Json>, req: ProviderRequest): Promise<{ from_date: string; to_date: string }> {
  const q = (req.history[req.history.length - 1]?.content ?? '').toLowerCase();
  const to = shiftDate(req.ctx.now, req.ctx.timezone, 0);
  if (/today/.test(q)) return { from_date: to, to_date: to };
  if (/yesterday/.test(q)) {
    const y = shiftDate(req.ctx.now, req.ctx.timezone, -1);
    return { from_date: y, to_date: y };
  }
  if (/month/.test(q)) return { from_date: shiftDate(req.ctx.now, req.ctx.timezone, -29), to_date: to };
  // "this week" / default: the last 7 days including today (calendar-week start depends on preferences).
  void call;
  return { from_date: shiftDate(req.ctx.now, req.ctx.timezone, -6), to_date: to };
}
