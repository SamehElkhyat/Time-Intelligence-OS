import { Inject, Injectable, Logger } from '@nestjs/common';
import { AIInteraction, AIPendingAction, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';
import { DomainError } from '@/common/http/errors';
import { MS_PER_HOUR } from '@/common/time/time';
import { ENV } from '@/config/config.module';
import { Env } from '@/config/env';
import { AuditService } from '@/infrastructure/audit/audit.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TasksService } from '../tasks/tasks.service';
import {
  CoachMessageDto,
  CoachReplyDto,
  CoachStatusDto,
  ConfirmedActionDto,
  ConversationDetailDto,
  ConversationSummaryDto,
  PendingActionDto,
  ToolCallDto,
} from './ai-coach.dto';
import { CoachToolsService } from './coach-tools.service';
import { AnthropicCoachProvider } from './providers/anthropic.provider';
import { COACH_SYSTEM_PROMPT, CoachProvider, estimateCostMicroUsd } from './providers/coach-provider';
import { DEMO_NOTICE, DemoCoachProvider } from './providers/demo.provider';

const HISTORY_TURNS = 20;
const ACTION_TTL_MS = 30 * 60_000;

const toMessage = (i: AIInteraction): CoachMessageDto => ({
  id: i.id,
  role: i.role,
  content: i.content,
  provider: i.provider,
  model: i.model,
  isDemo: i.isDemo,
  toolCalls: (i.toolCalls as unknown as ToolCallDto[] | null) ?? null,
  createdAt: i.createdAt,
});

const toAction = (a: AIPendingAction): PendingActionDto => ({
  id: a.id,
  conversationId: a.conversationId,
  type: a.type,
  summary: a.summary,
  payload: a.payload as Record<string, unknown>,
  status: a.status,
  expiresAt: a.expiresAt,
  createdAt: a.createdAt,
});

@Injectable()
export class AiCoachService {
  private readonly logger = new Logger(AiCoachService.name);
  readonly provider: CoachProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tools: CoachToolsService,
    private readonly tasks: TasksService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.provider = env.ANTHROPIC_API_KEY ? new AnthropicCoachProvider(env) : new DemoCoachProvider();
    this.logger.log(this.provider.isDemo ? 'AI coach running in DEMO mode (no ANTHROPIC_API_KEY)' : `AI coach using ${this.provider.model}`);
  }

  private async messagesToday(userId: string): Promise<number> {
    return this.prisma.aIInteraction.count({ where: { userId, role: 'USER', createdAt: { gte: new Date(Date.now() - 24 * MS_PER_HOUR) } } });
  }

  async status(userId: string): Promise<CoachStatusDto> {
    return {
      mode: this.provider.isDemo ? 'demo' : 'live',
      provider: this.provider.name,
      model: this.provider.model,
      notice: this.provider.isDemo ? DEMO_NOTICE : null,
      dailyMessageLimit: this.env.AI_DAILY_MESSAGE_LIMIT,
      messagesUsedToday: await this.messagesToday(userId),
      tools: this.tools.names(),
    };
  }

  async conversations(userId: string): Promise<ConversationSummaryDto[]> {
    return this.prisma.aIConversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, createdAt: true, updatedAt: true },
    });
  }

  private async ownedConversation(userId: string, id: string) {
    const c = await this.prisma.aIConversation.findFirst({ where: { id, userId } });
    if (!c) throw DomainError.notFound('Conversation');
    return c;
  }

  async conversation(userId: string, id: string): Promise<ConversationDetailDto> {
    const c = await this.ownedConversation(userId, id);
    const [messages, actions] = await Promise.all([
      this.prisma.aIInteraction.findMany({ where: { conversationId: id, userId }, orderBy: { createdAt: 'asc' }, take: 200 }),
      this.prisma.aIPendingAction.findMany({ where: { conversationId: id, userId }, orderBy: { createdAt: 'asc' } }),
    ]);
    const now = Date.now();
    return {
      id: c.id,
      title: c.title,
      messages: messages.map(toMessage),
      pendingActions: actions.map((a) => toAction(a.status === 'PENDING' && a.expiresAt.getTime() <= now ? { ...a, status: 'EXPIRED' } : a)),
    };
  }

  async deleteConversation(userId: string, id: string): Promise<void> {
    await this.ownedConversation(userId, id);
    await this.prisma.aIConversation.delete({ where: { id } });
    await this.audit.record({ userId, action: 'ai.conversation.deleted', entityType: 'AIConversation', entityId: id });
  }

  async send(userId: string, message: string, conversationId?: string): Promise<CoachReplyDto> {
    if ((await this.messagesToday(userId)) >= this.env.AI_DAILY_MESSAGE_LIMIT) {
      throw DomainError.tooMany('AI_LIMIT_REACHED', `You have reached the daily limit of ${this.env.AI_DAILY_MESSAGE_LIMIT} coach messages. It resets on a rolling 24-hour basis.`);
    }
    const conversation = conversationId
      ? await this.ownedConversation(userId, conversationId)
      : await this.prisma.aIConversation.create({ data: { userId, title: message.slice(0, 60) } });

    const prior = await this.prisma.aIInteraction.findMany({
      where: { conversationId: conversation.id, userId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_TURNS,
      select: { role: true, content: true },
    });
    prior.reverse();

    const ctx = await this.tools.context(userId, conversation.id);
    const local = DateTime.fromMillis(ctx.now, { zone: ctx.timezone });
    // Volatile context goes with the user's message, keeping the system prompt byte-stable (cacheable).
    const framed = `[Context: it is ${local.toFormat("cccc yyyy-LL-dd HH:mm")} in the user's timezone (${ctx.timezone}).]\n\n${message}`;

    // The user's message is stored (and counted against the limit) before the provider runs.
    const userRow = await this.prisma.aIInteraction.create({
      data: { conversationId: conversation.id, userId, role: 'USER', content: message, provider: this.provider.name, isDemo: this.provider.isDemo },
    });
    const startedAt = new Date();

    const result = await this.provider.run({
      system: COACH_SYSTEM_PROMPT,
      history: [...prior.map((p) => ({ role: p.role === 'USER' ? ('user' as const) : ('assistant' as const), content: p.content })), { role: 'user', content: framed }],
      tools: this.tools,
      ctx,
    });

    const usage = {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheReadTokens: result.cacheReadTokens,
      cacheWriteTokens: result.cacheWriteTokens,
    };
    const costMicroUsd = this.provider.isDemo ? 0 : estimateCostMicroUsd(result.model, usage);
    const replyRow = await this.prisma.aIInteraction.create({
      data: {
        conversationId: conversation.id,
        userId,
        role: 'ASSISTANT',
        content: result.text || 'I do not have an answer for that.',
        provider: this.provider.name,
        model: result.model,
        isDemo: this.provider.isDemo,
        toolCalls: result.toolCalls as unknown as Prisma.InputJsonValue,
        inputTokens: result.inputTokens + result.cacheReadTokens + result.cacheWriteTokens,
        outputTokens: result.outputTokens,
        costMicroUsd,
      },
    });
    await this.prisma.aIConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
    await this.audit.record({
      userId,
      actor: 'ai-coach',
      action: 'ai.message',
      entityType: 'AIConversation',
      entityId: conversation.id,
      metadata: { provider: this.provider.name, model: result.model, tools: result.toolCalls.map((t) => t.name), costMicroUsd, ...usage, note: result.note ?? null },
    });

    const pending = await this.prisma.aIPendingAction.findMany({
      where: { userId, conversationId: conversation.id, status: 'PENDING', createdAt: { gte: startedAt }, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      conversationId: conversation.id,
      userMessage: toMessage(userRow),
      reply: toMessage(replyRow),
      pendingActions: pending.map(toAction),
      usage: { inputTokens: result.inputTokens + result.cacheReadTokens + result.cacheWriteTokens, outputTokens: result.outputTokens, costMicroUsd, mode: this.provider.isDemo ? 'demo' : 'live' },
    };
  }

  // ── human confirmation of proposed changes ─────────────────────────────────

  private async claimPending(userId: string, id: string): Promise<AIPendingAction> {
    const action = await this.prisma.aIPendingAction.findFirst({ where: { id, userId } });
    if (!action) throw DomainError.notFound('Proposal');
    if (action.status !== 'PENDING') throw DomainError.conflict('PROPOSAL_RESOLVED', `This proposal was already ${action.status.toLowerCase()}.`);
    if (action.expiresAt.getTime() <= Date.now()) {
      await this.prisma.aIPendingAction.update({ where: { id }, data: { status: 'EXPIRED', resolvedAt: new Date() } });
      throw DomainError.conflict('PROPOSAL_EXPIRED', 'This proposal expired. Ask the coach again for a fresh one.');
    }
    return action;
  }

  async confirm(userId: string, id: string): Promise<ConfirmedActionDto> {
    const action = await this.claimPending(userId, id);
    // Atomic claim: only one concurrent confirmation can win.
    const claimed = await this.prisma.aIPendingAction.updateMany({ where: { id, userId, status: 'PENDING' }, data: { status: 'CONFIRMED', resolvedAt: new Date() } });
    if (claimed.count !== 1) throw DomainError.conflict('PROPOSAL_RESOLVED', 'This proposal was already handled.');
    try {
      let result: Record<string, unknown>;
      if (action.type === 'schedule_task') {
        const p = action.payload as { taskId: string; start: string; end: string };
        // Goes through the normal task service, which re-validates everything against the current schedule.
        const activity = await this.tasks.schedule(userId, p.taskId, { start: new Date(p.start), end: new Date(p.end) });
        result = { activityId: activity.id, plannedStart: activity.plannedStart, plannedEnd: activity.plannedEnd };
      } else {
        throw DomainError.badRequest('UNSUPPORTED_ACTION', 'This kind of proposal is not supported.');
      }
      await this.audit.record({ userId, actor: 'user', action: 'ai.action.confirmed', entityType: 'AIPendingAction', entityId: id, metadata: { type: action.type, summary: action.summary, result } });
      const fresh = await this.prisma.aIPendingAction.findUniqueOrThrow({ where: { id } });
      return { action: toAction(fresh), result };
    } catch (err) {
      // The change was not applied (for example the slot was taken meanwhile): make it retryable.
      await this.prisma.aIPendingAction.updateMany({ where: { id, userId, status: 'CONFIRMED' }, data: { status: 'PENDING', resolvedAt: null } });
      throw err;
    }
  }

  async reject(userId: string, id: string): Promise<PendingActionDto> {
    const action = await this.claimPending(userId, id);
    const updated = await this.prisma.aIPendingAction.update({ where: { id: action.id }, data: { status: 'REJECTED', resolvedAt: new Date() } });
    await this.audit.record({ userId, action: 'ai.action.rejected', entityType: 'AIPendingAction', entityId: id, metadata: { type: action.type, summary: action.summary } });
    return toAction(updated);
  }
}

export { ACTION_TTL_MS };
