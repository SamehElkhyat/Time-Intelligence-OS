import Anthropic from '@anthropic-ai/sdk';
import { Logger } from '@nestjs/common';
import { Env } from '@/config/env';
import { DomainError } from '@/common/http/errors';
import { ToolCallDto } from '../ai-coach.dto';
import { TOOL_DEFINITIONS } from '../coach-tools.service';
import { CoachProvider, ProviderRequest, ProviderResult } from './coach-provider';

/** Upper bound on model <-> tool round trips for one user message. */
const MAX_ITERATIONS = 6;

// Minimal structural types for the parts of the response we read. Keeping these local means a
// change in the SDK's generated unions cannot silently break the loop.
interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}
interface ModelResponse {
  content: ContentBlock[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
  model?: string;
}
type Message = { role: 'user' | 'assistant'; content: string | ContentBlock[] | unknown[] };

/**
 * Real-model provider (Anthropic Messages API, manual tool loop).
 *
 *  - Thinking is always on for the default model; `thinking` is therefore omitted and depth is
 *    controlled with `output_config.effort`.
 *  - Server-side refusal fallbacks are enabled, so a policy decline on the primary model is
 *    retried by the platform instead of surfacing as an empty answer.
 *  - The assistant turn is appended to the transcript exactly as received (thinking blocks
 *    included) while the tool loop runs.
 */
export class AnthropicCoachProvider implements CoachProvider {
  readonly name = 'anthropic' as const;
  readonly isDemo = false;
  readonly model: string;
  private readonly logger = new Logger(AnthropicCoachProvider.name);
  private readonly client: Anthropic;

  constructor(private readonly env: Env) {
    this.model = env.AI_MODEL;
    this.client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
  }

  private async call(system: string, messages: Message[]): Promise<ModelResponse> {
    const params = {
      model: this.model,
      max_tokens: this.env.AI_MAX_OUTPUT_TOKENS,
      system,
      tools: TOOL_DEFINITIONS,
      messages,
      output_config: { effort: this.env.AI_EFFORT },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    };
    try {
      return (await this.client.beta.messages.create(params as never)) as unknown as ModelResponse;
    } catch (err) {
      if (err instanceof Anthropic.APIError) {
        this.logger.error(`Anthropic API error ${err.status ?? ''}: ${err.message}`);
        if (err.status === 401 || err.status === 403) {
          throw new DomainError(502, 'AI_PROVIDER_AUTH', 'The AI provider rejected the configured credentials. Check ANTHROPIC_API_KEY.');
        }
        if (err.status === 429) throw DomainError.tooMany('AI_PROVIDER_BUSY', 'The AI provider is busy right now. Please try again in a moment.');
        throw new DomainError(502, 'AI_PROVIDER_ERROR', 'The AI provider could not complete the request. Please try again.');
      }
      throw err;
    }
  }

  async run(req: ProviderRequest): Promise<ProviderResult> {
    const messages: Message[] = req.history.map((t) => ({ role: t.role, content: t.content }));
    const result: ProviderResult = {
      text: '',
      toolCalls: [],
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      model: this.model,
    };

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const response = await this.call(req.system, messages);
      result.inputTokens += response.usage.input_tokens;
      result.outputTokens += response.usage.output_tokens;
      result.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
      result.cacheWriteTokens += response.usage.cache_creation_input_tokens ?? 0;
      if (response.model) result.model = response.model;

      const text = response.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();

      if (response.stop_reason === 'refusal') {
        result.note = 'REFUSED';
        result.text = text || 'The AI provider declined to answer this request. Try rephrasing it.';
        return result;
      }
      if (response.stop_reason === 'max_tokens') {
        result.note = 'MAX_TOKENS';
        result.text = text || 'The answer was cut off before it could be completed. Try a narrower question.';
        return result;
      }
      if (response.stop_reason !== 'tool_use') {
        result.text = text;
        return result;
      }

      // Execute every requested tool, then return all results in ONE user message.
      messages.push({ role: 'assistant', content: response.content });
      const toolUses = response.content.filter((b) => b.type === 'tool_use');
      const results = [];
      for (const use of toolUses) {
        const out = await req.tools.execute(req.ctx, use.name ?? '', use.input);
        result.toolCalls.push(out.log as ToolCallDto);
        results.push({ type: 'tool_result', tool_use_id: use.id, content: out.content, ...(out.isError ? { is_error: true } : {}) });
      }
      messages.push({ role: 'user', content: results });
    }

    result.note = 'ITERATION_LIMIT';
    result.text = 'I needed more steps than I am allowed to take for one question. Try asking something more specific.';
    return result;
  }
}
