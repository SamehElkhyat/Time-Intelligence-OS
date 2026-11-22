import { Module } from '@nestjs/common';
import { TimeTrackingModule } from '../time-tracking/time-tracking.module';
import { ActivitiesController } from './activities.controller';
import { ActivitiesService } from './activities.service';

@Module({
  imports: [TimeTrackingModule],
  controllers: [ActivitiesController],
  providers: [ActivitiesService],
  exports: [ActivitiesService],
})
export class ActivitiesModule {}
