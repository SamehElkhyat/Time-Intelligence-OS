import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '@/common/http/decorators';
import { OkDto } from '@/common/http/pagination.dto';
import { ActivityDto } from '../activities/activities.dto';
import { EnergyService } from './energy.service';
import { PlannerService } from './planner.service';
import { ScheduleEventsService } from './schedule-events.service';
import {
  ApplyPlanDto,
  ApplyPlanResultDto,
  CreateScheduleEventDto,
  EnergyLogDto,
  EnergyOverviewDto,
  EnergyQueryDto,
  LogEnergyDto,
  OccurrenceDateDto,
  PlanDto,
  PlanRequestDto,
  ScheduleEventDto,
  UpdateScheduleEventDto,
} from './scheduling.dto';

@ApiTags('scheduling')
@ApiCookieAuth()
@Controller()
export class SchedulingController {
  constructor(
    private readonly energy: EnergyService,
    private readonly events: ScheduleEventsService,
    private readonly planner: PlannerService,
  ) {}

  // ── energy ─────────────────────────────────────────────────────────────────

  @Post('energy/logs')
  @ApiOperation({ summary: 'Record current energy and focus' })
  logEnergy(@CurrentUser() user: AuthUser, @Body() dto: LogEnergyDto): Promise<EnergyLogDto> {
    return this.energy.log(user.id, dto);
  }

  @Get('energy/logs')
  @ApiOperation({ summary: 'Energy check-in history (default: last 14 days)' })
  energyLogs(@CurrentUser() user: AuthUser, @Query() q: EnergyQueryDto): Promise<EnergyLogDto[]> {
    return this.energy.list(user.id, q);
  }

  @Get('energy/overview')
  @ApiOperation({ summary: 'Current state and hour-by-hour expectation built from the user’s own check-ins' })
  energyOverview(@CurrentUser() user: AuthUser): Promise<EnergyOverviewDto> {
    return this.energy.overview(user.id);
  }

  // ── recurring commitments ──────────────────────────────────────────────────

  @Get('schedule/events')
  @ApiOperation({ summary: 'Recurring commitments' })
  listEvents(@CurrentUser() user: AuthUser): Promise<ScheduleEventDto[]> {
    return this.events.list(user.id);
  }

  @Post('schedule/events')
  createEvent(@CurrentUser() user: AuthUser, @Body() dto: CreateScheduleEventDto): Promise<ScheduleEventDto> {
    return this.events.create(user.id, dto);
  }

  @Patch('schedule/events/:id')
  updateEvent(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateScheduleEventDto): Promise<ScheduleEventDto> {
    return this.events.update(user.id, id, dto);
  }

  @Delete('schedule/events/:id')
  async removeEvent(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OkDto> {
    await this.events.remove(user.id, id);
    return { ok: true };
  }

  @Post('schedule/events/:id/skip')
  @HttpCode(200)
  @ApiOperation({ summary: 'Skip a single occurrence' })
  skip(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OccurrenceDateDto): Promise<ScheduleEventDto> {
    return this.events.skip(user.id, id, dto.date);
  }

  @Post('schedule/events/:id/materialise')
  @HttpCode(200)
  @ApiOperation({ summary: 'Turn one occurrence into a trackable activity (idempotent)' })
  materialise(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: OccurrenceDateDto): Promise<ActivityDto> {
    return this.events.materialise(user.id, id, dto.date);
  }

  // ── smart scheduling ───────────────────────────────────────────────────────

  @Post('scheduling/plan')
  @HttpCode(200)
  @ApiOperation({ summary: 'Propose an energy-aware plan for a day. Nothing is saved.' })
  plan(@CurrentUser() user: AuthUser, @Body() dto: PlanRequestDto): Promise<PlanDto> {
    return this.planner.plan(user.id, dto);
  }

  @Post('scheduling/apply')
  @ApiOperation({ summary: 'Create work blocks from a proposal (each block is re-validated)' })
  apply(@CurrentUser() user: AuthUser, @Body() dto: ApplyPlanDto): Promise<ApplyPlanResultDto> {
    return this.planner.apply(user.id, dto.blocks);
  }
}
