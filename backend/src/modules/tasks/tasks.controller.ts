import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '@/common/http/decorators';
import { OkDto } from '@/common/http/pagination.dto';
import { ActivityDto } from '../activities/activities.dto';
import {
  CreateSubtaskDto,
  CreateTaskDto,
  ScheduleTaskDto,
  SetDependenciesDto,
  SubtaskDto,
  TaskDto,
  TaskHistoryEntryDto,
  TaskListDto,
  TaskQueryDto,
  UpdateSubtaskDto,
  UpdateTaskDto,
} from './tasks.dto';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@ApiCookieAuth()
@Controller('tasks')
export class TasksController {
  constructor(private readonly service: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'List, filter and search tasks' })
  list(@CurrentUser() user: AuthUser, @Query() query: TaskQueryDto): Promise<TaskListDto> {
    return this.service.list(user.id, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a task (optionally recurring, with subtasks and dependencies)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTaskDto): Promise<TaskDto> {
    return this.service.create(user.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TaskDto> {
    return this.service.get(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto): Promise<TaskDto> {
    return this.service.update(user.id, id, dto);
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<OkDto> {
    await this.service.remove(user.id, id);
    return { ok: true };
  }

  @Post(':id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Complete a task. Rejected with TASK_BLOCKED while dependencies are open.' })
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TaskDto> {
    return this.service.complete(user.id, id);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TaskDto> {
    return this.service.reopen(user.id, id);
  }

  @Put(':id/dependencies')
  @ApiOperation({ summary: 'Replace the dependencies of a task. Cycles are rejected with DEPENDENCY_CYCLE.' })
  dependencies(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetDependenciesDto): Promise<TaskDto> {
    return this.service.setDependencies(user.id, id, dto.dependsOnIds);
  }

  @Post(':id/schedule')
  @ApiOperation({ summary: 'Schedule a work block for the task on the calendar' })
  schedule(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ScheduleTaskDto): Promise<ActivityDto> {
    return this.service.schedule(user.id, id, dto);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Change history of a task' })
  history(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<TaskHistoryEntryDto[]> {
    return this.service.history(user.id, id);
  }

  @Post(':id/subtasks')
  addSubtask(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateSubtaskDto): Promise<SubtaskDto> {
    return this.service.addSubtask(user.id, id, dto.title);
  }

  @Patch(':id/subtasks/:subtaskId')
  updateSubtask(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subtaskId', ParseUUIDPipe) subtaskId: string,
    @Body() dto: UpdateSubtaskDto,
  ): Promise<SubtaskDto> {
    return this.service.updateSubtask(user.id, id, subtaskId, dto);
  }

  @Delete(':id/subtasks/:subtaskId')
  async removeSubtask(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('subtaskId', ParseUUIDPipe) subtaskId: string,
  ): Promise<OkDto> {
    await this.service.removeSubtask(user.id, id, subtaskId);
    return { ok: true };
  }
}
