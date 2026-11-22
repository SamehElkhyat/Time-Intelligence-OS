import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Transform } from 'class-transformer';

export class ToolCallDto {
  name: string;
  /** Arguments the model supplied (validated server-side before use). */
  @ApiProperty({ type: Object, additionalProperties: true }) input: Record<string, unknown>;
  ok: boolean;
  durationMs: number;
  @ApiProperty({ type: String, nullable: true }) error: string | null;
}

export class CoachMessageDto {
  id: string;
  @ApiProperty({ enum: ['USER', 'ASSISTANT'], enumName: 'AiRole' }) role: string;
  content: string;
  /** "anthropic" for a real model, "demo" for the deterministic demo engine. */
  provider: string;
  @ApiProperty({ type: String, nullable: true }) model: string | null;
  /** True when the answer was produced by the demo engine, not a language model. */
  isDemo: boolean;
  @ApiProperty({ type: [ToolCallDto], nullable: true }) toolCalls: ToolCallDto[] | null;
  createdAt: Date;
}

export class PendingActionDto {
  id: string;
  conversationId: string;
  type: string;
  /** Plain-language description of the change that will be made if confirmed. */
  summary: string;
  @ApiProperty({ type: Object, additionalProperties: true }) payload: Record<string, unknown>;
  @ApiProperty({ enum: ['PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED'], enumName: 'PendingActionStatus' }) status: string;
  expiresAt: Date;
  createdAt: Date;
}

export class CoachUsageDto {
  inputTokens: number;
  outputTokens: number;
  /** Estimated cost in millionths of a US dollar (0 in demo mode). */
  costMicroUsd: number;
  @ApiProperty({ enum: ['live', 'demo'], enumName: 'CoachMode' }) mode: 'live' | 'demo';
}

export class CoachReplyDto {
  conversationId: string;
  userMessage: CoachMessageDto;
  reply: CoachMessageDto;
  /** Schedule changes the coach proposed. Nothing changes until the user confirms. */
  pendingActions: PendingActionDto[];
  usage: CoachUsageDto;
}

export class CoachStatusDto {
  @ApiProperty({ enum: ['live', 'demo'], enumName: 'CoachMode' }) mode: 'live' | 'demo';
  provider: string;
  @ApiProperty({ type: String, nullable: true }) model: string | null;
  /** Shown to the user whenever mode is "demo". */
  @ApiProperty({ type: String, nullable: true }) notice: string | null;
  dailyMessageLimit: number;
  messagesUsedToday: number;
  /** Tools the coach may call. All are read-only except proposals, which need confirmation. */
  tools: string[];
}

export class ConversationSummaryDto {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

export class ConversationDetailDto {
  id: string;
  title: string;
  messages: CoachMessageDto[];
  pendingActions: PendingActionDto[];
}

export class SendMessageDto {
  /** Continue an existing conversation; omit to start a new one. */
  @IsOptional() @IsUUID() conversationId?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 2000)
  message: string;
}

export class ConfirmedActionDto {
  action: PendingActionDto;
  /** Result of applying it, e.g. the created activity id. */
  @ApiProperty({ type: Object, additionalProperties: true }) result: Record<string, unknown>;
}
