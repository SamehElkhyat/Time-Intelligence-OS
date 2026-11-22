import { Module } from '@nestjs/common';
import { TimeTrackingModule } from '../time-tracking/time-tracking.module';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { DayContextService } from './day-context.service';
import { HistoryService } from './history.service';

@Module({
  imports: [TimeTrackingModule],
  controllers: [AvailabilityController],
  providers: [AvailabilityService, DayContextService, HistoryService],
  exports: [AvailabilityService, DayContextService, HistoryService],
})
export class AvailabilityModule {}
