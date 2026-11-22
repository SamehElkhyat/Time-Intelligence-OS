import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { TimeTrackingModule } from '../time-tracking/time-tracking.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [AvailabilityModule, TimeTrackingModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
