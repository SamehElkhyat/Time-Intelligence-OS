'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, FlaskConical, MessageSquarePlus, Send, Trash2, Wrench, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/app/primitives';
import { ErrorState, LoadingState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, Progress } from '@/components/ui/card';
import { Tooltip } from '@/components/ui/overlay';
import { errorMessage, invalidateTimeData } from '@/hooks/use-mutation-toast';
import { qk } from '@/lib/query-keys';
import { fmtDateTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { useAuth } from '@/providers/auth-provider';
import { coachApi } from '@/services';
import type { CoachMessage, PendingAction } from '@/types';

const TOOL_LABEL: Record<string, string> = {
  get_day_overview: 'your day overview',
  get_free_windows: 'your free windows',
  find_free_slots: 'free slots',
  recommend_tasks: 'task recommendations',
  list_tasks: 'your tasks',
  get_time_summary: 'your tracked time',
  get_leakage_insights: 'time-leakage findings',
  get_productivity_patterns: 'your productivity patterns',
  propose_schedule_task: 'a schedule proposal',
};

const PRESETS = [
  'What should I do with the next 40 minutes?',
  'Why did I fail to complete my tasks yesterday?',
  'How much time did I spend learning this week?',
  'Find a suitable time for my next deep work session.',
  'Analyze my schedule and suggest improvements.',
  'Summarize my day.',
];

export function AiCoachView() {
  const { tz, use24h } = useAuth();
  const qc = useQueryClient();
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [proposals, setProposals] = useState<PendingAction[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  const status = useQuery({ queryKey: qk.coachStatus, queryFn: coachApi.status });
  const conversations = useQuery({ queryKey: qk.conversations, queryFn: coachApi.conversations });
  const convo = useQuery({ queryKey: qk.conversation(conversationId ?? ''), queryFn: () => coachApi.conversation(conversationId!), enabled: Boolean(conversationId) });

  const send = useMutation({
    mutationFn: (message: string) => coachApi.send({ message, conversationId }),
    onMutate: (m) => setPending(m),
    onSuccess: async (r) => {
      setConversationId(r.conversationId);
      setProposals((p) => [...p.filter((x) => x.conversationId === r.conversationId), ...r.pendingActions]);
      await Promise.all([qc.invalidateQueries({ queryKey: qk.conversation(r.conversationId) }), qc.invalidateQueries({ queryKey: qk.conversations }), qc.invalidateQueries({ queryKey: qk.coachStatus })]);
    },
    onError: (e, m) => (toast.error(errorMessage(e)), setDraft(m)),
    onSettled: () => setPending(null),
  });
  const confirm = useMutation({
    mutationFn: (id: string) => coachApi.confirm(id),
    onSuccess: async (_r, id) => (toast.success('Scheduled'), setProposals((p) => p.filter((x) => x.id !== id)), await invalidateTimeData(qc)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const reject = useMutation({
    mutationFn: (id: string) => coachApi.reject(id),
    onSuccess: (_r, id) => setProposals((p) => p.filter((x) => x.id !== id)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => coachApi.remove(id),
    onSuccess: async (_r, id) => {
      if (id === conversationId) (setConversationId(undefined), setProposals([]));
      await qc.invalidateQueries({ queryKey: qk.conversations });
    },
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [convo.data?.messages.length, pending]);
  // Proposals still waiting (also after a reload) come from the conversation itself.
  const open = [...(convo.data?.pendingActions ?? []).filter((a) => a.status === 'PENDING'), ...proposals].filter((a, i, all) => all.findIndex((b) => b.id === a.id) === i);

  const submit = (text = draft) => {
    const m = text.trim();
    if (!m || send.isPending) return;
    setDraft('');
    send.mutate(m);
  };

  const s = status.data;
  const messages: CoachMessage[] = convo.data?.messages ?? [];

  return (
    <>
      <PageHeader title="AI Time Coach" description="Ask about your schedule in plain language. It can only read your data through authorized tools, and it cannot change anything without your confirmation." />

      {s?.mode === 'demo' && (
        <div role="note" className="mb-4 flex items-start gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-warning">
          <FlaskConical className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{s.notice}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <aside aria-label="Conversations" className="space-y-2 lg:max-h-[calc(100dvh-260px)] lg:overflow-y-auto">
          <Button variant="outline" className="w-full" onClick={() => (setConversationId(undefined), setProposals([]))}>
            <MessageSquarePlus className="size-4" /> New conversation
          </Button>
          {conversations.data?.map((c) => (
            <div key={c.id} className={cn('group flex items-center gap-1 rounded-lg border px-3 py-2 text-sm transition-colors', c.id === conversationId ? 'border-primary/40 bg-primary-soft' : 'border-border hover:border-border-strong')}>
              <button type="button" onClick={() => (setConversationId(c.id), setProposals([]))} className="min-w-0 flex-1 truncate text-left text-fg-secondary" aria-current={c.id === conversationId}>
                {c.title}
              </button>
              <button type="button" aria-label={`Delete conversation ${c.title}`} onClick={() => remove.mutate(c.id)} className="rounded p-1 text-fg-muted opacity-0 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100">
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </aside>

        <Card className="flex min-h-[520px] flex-col">
          <CardContent className="flex flex-1 flex-col gap-4 p-5">
            <div className="flex-1 space-y-5 overflow-y-auto" role="log" aria-live="polite" aria-label="Conversation">
              {conversationId && convo.isLoading ? (
                <LoadingState />
              ) : conversationId && convo.isError ? (
                <ErrorState error={convo.error} />
              ) : messages.length === 0 && !pending ? (
                <div className="mx-auto max-w-xl py-8 text-center">
                  <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-primary-soft text-primary">
                    <Bot className="size-5" aria-hidden />
                  </div>
                  <h2 className="text-base font-semibold text-fg">What would you like to know about your time?</h2>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {PRESETS.map((p) => (
                      <button key={p} type="button" onClick={() => submit(p)} className="rounded-full border border-border px-3.5 py-2 text-[13px] text-fg-secondary transition-colors hover:border-primary/40 hover:text-primary">
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((m) => (
                    <Message key={m.id} m={m} tz={tz} use24h={use24h} />
                  ))}
                  {pending && (
                    <>
                      <Bubble role="USER" text={pending} />
                      <div role="status" className="flex items-center gap-2 text-sm text-fg-muted">
                        <span className="tf-pulse inline-block size-2 rounded-full bg-primary" /> Looking at your data…
                      </div>
                    </>
                  )}
                </>
              )}
              {open.map((a) => (
                <div key={a.id} className="rounded-xl border border-primary/30 bg-primary-soft p-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-primary">Proposed change · needs your confirmation</div>
                  <p className="mt-1.5 text-sm text-fg">{a.summary}</p>
                  <p className="mt-1 text-xs text-fg-muted">Nothing has been scheduled. Expires {fmtDateTime(a.expiresAt, tz, use24h)}.</p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="primary" loading={confirm.isPending && confirm.variables === a.id} onClick={() => confirm.mutate(a.id)}>
                      <Check className="size-4" /> Confirm
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => reject.mutate(a.id)}>
                      <X className="size-4" /> Dismiss
                    </Button>
                  </div>
                </div>
              ))}
              <div ref={endRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
              className="space-y-2 border-t border-border pt-4"
            >
              <div className="flex items-end gap-2">
                <textarea
                  aria-label="Message to the coach"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  rows={2}
                  maxLength={2000}
                  placeholder="Ask anything about your time… (Enter to send, Shift+Enter for a new line)"
                  className="min-h-[56px] flex-1 resize-none rounded-md border border-border-strong bg-surface-2 px-3 py-2.5 text-sm text-fg placeholder:text-fg-muted focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary-ring)]"
                />
                <Button type="submit" variant="primary" size="lg" disabled={!draft.trim()} loading={send.isPending} aria-label="Send message">
                  <Send className="size-4" />
                </Button>
              </div>
              {s && (
                <div className="flex items-center gap-3 text-xs text-fg-muted">
                  <Progress className="w-28" value={(s.messagesUsedToday / s.dailyMessageLimit) * 100} tone={s.messagesUsedToday / s.dailyMessageLimit > 0.8 ? 'warning' : 'primary'} label="Daily message allowance" />
                  <span className="tabular">
                    {s.messagesUsedToday} of {s.dailyMessageLimit} messages used in the last 24 h
                  </span>
                </div>
              )}
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Bubble({ role, text }: { role: 'USER' | 'ASSISTANT'; text: string }) {
  return (
    <div className={cn('flex', role === 'USER' ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed', role === 'USER' ? 'rounded-br-md bg-elevated text-fg' : 'rounded-bl-md border border-border bg-surface-2 text-fg-secondary')}>{text}</div>
    </div>
  );
}

function Message({ m, tz, use24h }: { m: CoachMessage; tz: string; use24h: boolean }) {
  if (m.role === 'USER') return <Bubble role="USER" text={m.content} />;
  const tools = [...new Set((m.toolCalls ?? []).map((t) => t.name))];
  const failed = (m.toolCalls ?? []).filter((t) => !t.ok);
  return (
    <div>
      <Bubble role="ASSISTANT" text={m.content} />
      <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-1 text-xs text-fg-muted">
        {m.isDemo ? (
          <Tooltip content="Produced by a deterministic rule-based engine over your data, not by a language model.">
            <Badge tone="warning" className="cursor-help">
              Demo engine
            </Badge>
          </Tooltip>
        ) : (
          <Badge tone="primary">{m.model ?? 'AI'}</Badge>
        )}
        {tools.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <Wrench className="size-3" aria-hidden /> Looked at {tools.map((t) => TOOL_LABEL[t] ?? t).join(', ')}
          </span>
        )}
        {failed.length > 0 && <span className="text-warning">{failed.length} lookup{failed.length === 1 ? '' : 's'} failed</span>}
        <span className="tabular">{fmtDateTime(m.createdAt, tz, use24h)}</span>
      </div>
    </div>
  );
}
