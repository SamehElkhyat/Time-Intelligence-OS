import { Controller, Get, HttpCode, MessageEvent, Param, ParseUUIDPipe, Post, Query, Sse } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { interval, map, merge, Observable } from 'rxjs';
import { AuthUser, CurrentUser } from '@/common/http/decorators';
import { OkDto } from '@/common/http/pagination.dto';
import { RealtimeService } from '@/infrastructure/realtime/realtime.service';
import { NotificationListDto, NotificationQueryDto, UnreadCountDto } from './notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiCookieAuth()
@Controller()
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  @Get('notifications')
  @ApiOperation({ summary: 'In-app notifications' })
  list(@CurrentUser() user: AuthUser, @Query() query: NotificationQueryDto): Promise<NotificationListDto> {
    return this.service.list(user.id, query);
  }

  @Get('notifications/unread-count')
  async unread(@CurrentUser() user: AuthUser): Promise<UnreadCountDto> {
    return { count: await this.service.unreadCount(user.id) };
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() user: AuthUser): Promise<UnreadCountDto> {
    return { count: await this.service.markAllRead(user.id) };
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  async read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OkDto> {
    await this.service.markRead(user.id, id);
    return { ok: true };
  }

  /**
   * Server-Sent Events stream of "something changed" hints for this user
   * (timer, schedule, tasks, notifications, analytics). Payloads are intentionally tiny:
   * clients re-fetch through the normal API. A heartbeat keeps proxies from closing the stream.
   */
  @SkipThrottle()
  @Sse('events/stream')
  @ApiOperation({ summary: 'Realtime change stream (text/event-stream)' })
  stream(@CurrentUser() user: AuthUser): Observable<MessageEvent> {
    const changes = this.realtime.streamFor(user.id).pipe(map((m): MessageEvent => ({ type: 'change', data: m })));
    const heartbeat = interval(25_000).pipe(map((): MessageEvent => ({ type: 'ping', data: { t: Date.now() } })));
    return merge(changes, heartbeat);
  }
}
