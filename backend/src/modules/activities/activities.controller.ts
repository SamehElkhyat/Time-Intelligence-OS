import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '@/common/http/decorators';
import { OkDto } from '@/common/http/pagination.dto';
import {
  ActivityDto,
  ActivityListDto,
  ActivityQueryDto,
  CreateActivityDto,
  DuplicateActivityDto,
  RescheduleActivityDto,
  UpdateActivityDto,
} from './activities.dto';
import { ActivitiesService } from './activities.service';

@ApiTags('activities')
@ApiCookieAuth()
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly service: ActivitiesService) {}

  @Get()
  @ApiOperation({ summary: 'List, filter and search activities' })
  list(@CurrentUser() user: AuthUser, @Query() query: ActivityQueryDto): Promise<ActivityListDto> {
    return this.service.list(user.id, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create an activity' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateActivityDto): Promise<ActivityDto> {
    return this.service.create(user.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ActivityDto> {
    return this.service.get(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit an activity' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateActivityDto): Promise<ActivityDto> {
    return this.service.update(user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove an activity from the plan (tracked history is preserved)' })
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OkDto> {
    await this.service.remove(user.id, id);
    return { ok: true };
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  @ApiOperation({ summary: 'Move an activity to a new time (used by timeline drag and drop)' })
  reschedule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RescheduleActivityDto): Promise<ActivityDto> {
    return this.service.reschedule(user.id, id, dto);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate an activity (plan only — tracked time is not copied)' })
  duplicate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DuplicateActivityDto): Promise<ActivityDto> {
    return this.service.duplicate(user.id, id, dto);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark as completed (stops its timer if running)' })
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ActivityDto> {
    return this.service.complete(user.id, id);
  }

  @Post(':id/skip')
  @HttpCode(200)
  skip(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ActivityDto> {
    return this.service.skip(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ActivityDto> {
    return this.service.cancel(user.id, id);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<ActivityDto> {
    return this.service.reopen(user.id, id);
  }
}
