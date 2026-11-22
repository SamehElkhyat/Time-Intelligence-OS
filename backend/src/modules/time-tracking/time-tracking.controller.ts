import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '@/common/http/decorators';
import { OkDto } from '@/common/http/pagination.dto';
import {
  ActiveTimerDto,
  CorrectionDto,
  CorrectSessionDto,
  DeleteSessionDto,
  ManualEntryDto,
  SessionListDto,
  SessionQueryDto,
  StartTimerDto,
  StartTimerResultDto,
  StopTimerDto,
  TimerActionDto,
  TimeSessionDto,
} from './time-tracking.dto';
import { TimeTrackingService } from './time-tracking.service';

@ApiTags('time-tracking')
@ApiCookieAuth()
@Controller('time-tracking')
export class TimeTrackingController {
  constructor(private readonly service: TimeTrackingService) {}

  @Get('active')
  @ApiOperation({ summary: 'Active timer with server-computed elapsed time (survives refresh and browser restarts)' })
  active(@CurrentUser() user: AuthUser): Promise<ActiveTimerDto> {
    return this.service.getActive(user.id);
  }

  @Post('start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start (or switch to) a timer. Idempotent for the activity already being tracked.' })
  start(@CurrentUser() user: AuthUser, @Body() dto: StartTimerDto): Promise<StartTimerResultDto> {
    return this.service.start(user.id, dto);
  }

  @Post('pause')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pause the running timer' })
  pause(@CurrentUser() user: AuthUser, @Body() dto: TimerActionDto): Promise<ActiveTimerDto> {
    return this.service.pause(user.id, dto);
  }

  @Post('resume')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resume the paused timer' })
  resume(@CurrentUser() user: AuthUser, @Body() dto: TimerActionDto): Promise<ActiveTimerDto> {
    return this.service.resume(user.id, dto);
  }

  @Post('stop')
  @HttpCode(200)
  @ApiOperation({ summary: 'Stop the active timer; optionally complete the activity. Returns the final session.' })
  stop(@CurrentUser() user: AuthUser, @Body() dto: StopTimerDto): Promise<ActiveTimerDto> {
    return this.service.stop(user.id, dto);
  }

  @Post('manual')
  @ApiOperation({ summary: 'Add a manual time entry (must not overlap tracked time)' })
  manual(@CurrentUser() user: AuthUser, @Body() dto: ManualEntryDto): Promise<TimeSessionDto> {
    return this.service.manualEntry(user.id, dto);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Tracking history' })
  sessions(@CurrentUser() user: AuthUser, @Query() query: SessionQueryDto): Promise<SessionListDto> {
    return this.service.listSessions(user.id, query);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'One time entry' })
  session(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TimeSessionDto> {
    return this.service.getSession(user.id, id);
  }

  @Patch('sessions/:id')
  @ApiOperation({ summary: 'Correct a stopped time entry. The previous values are kept in the audit trail.' })
  correct(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CorrectSessionDto): Promise<TimeSessionDto> {
    return this.service.correctSession(user.id, id, dto);
  }

  @Delete('sessions/:id')
  @ApiOperation({ summary: 'Delete a stopped time entry (content preserved in the audit trail)' })
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeleteSessionDto): Promise<OkDto> {
    await this.service.deleteSession(user.id, id, dto.reason);
    return { ok: true };
  }

  @Get('sessions/:id/corrections')
  @ApiOperation({ summary: 'Audit trail of a time entry' })
  corrections(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<CorrectionDto[]> {
    return this.service.corrections(user.id, id);
  }
}
