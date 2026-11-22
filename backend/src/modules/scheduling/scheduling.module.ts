import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { TasksModule } from '../tasks/tasks.module';
import { EnergyService } from './energy.service';
import { PlannerService } from './planner.service';
import { ScheduleEventsService } from './schedule-events.service';
import { SchedulingController } from './scheduling.controller';

@Module({
  imports: [AvailabilityModule, TasksModule],
  controllers: [SchedulingController],
  providers: [EnergyService, ScheduleEventsService, PlannerService],
  exports: [EnergyService, PlannerService, ScheduleEventsService],
})
export class SchedulingModule {}
