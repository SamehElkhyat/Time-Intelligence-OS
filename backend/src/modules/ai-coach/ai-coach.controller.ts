import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser, CurrentUser } from '@/common/http/decorators';
import { OkDto } from '@/common/http/pagination.dto';
import {
  CoachReplyDto,
  CoachStatusDto,
  ConfirmedActionDto,
  ConversationDetailDto,
  ConversationSummaryDto,
  PendingActionDto,
  SendMessageDto,
} from './ai-coach.dto';
import { AiCoachService } from './ai-coach.service';

@ApiTags('ai-coach')
@ApiCookieAuth()
@Controller('ai-coach')
export class AiCoachController {
  constructor(private readonly service: AiCoachService) {}

  @Get('status')
  @ApiOperation({ summary: 'Coach mode (live or demo), model, daily limit and usage' })
  status(@CurrentUser() user: AuthUser): Promise<CoachStatusDto> {
    return this.service.status(user.id);
  }

  @Post('messages')
  @HttpCode(200)
  @Throttle({ default: { limit: 12, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Ask the coach',
    description:
      'The coach reads data only through authorized, read-only tools. Schedule changes are returned as pending proposals that must be confirmed separately. Replies from the demo engine are flagged isDemo.',
  })
  send(@CurrentUser() user: AuthUser, @Body() dto: SendMessageDto): Promise<CoachReplyDto> {
    return this.service.send(user.id, dto.message, dto.conversationId);
  }

  @Get('conversations')
  conversations(@CurrentUser() user: AuthUser): Promise<ConversationSummaryDto[]> {
    return this.service.conversations(user.id);
  }

  @Get('conversations/:id')
  conversation(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ConversationDetailDto> {
    return this.service.conversation(user.id, id);
  }

  @Delete('conversations/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OkDto> {
    await this.service.deleteConversation(user.id, id);
    return { ok: true };
  }

  @Post('actions/:id/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a proposed schedule change. Only this call modifies the schedule.' })
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ConfirmedActionDto> {
    return this.service.confirm(user.id, id);
  }

  @Post('actions/:id/reject')
  @HttpCode(200)
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<PendingActionDto> {
    return this.service.reject(user.id, id);
  }
}
