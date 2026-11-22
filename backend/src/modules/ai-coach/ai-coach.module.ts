import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AvailabilityModule } from '../availability/availability.module';
import { ProductivityModule } from '../productivity/productivity.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { TasksModule } from '../tasks/tasks.module';
import { AiCoachController } from './ai-coach.controller';
import { AiCoachService } from './ai-coach.service';
import { CoachToolsService } from './coach-tools.service';

@Module({
  imports: [AnalyticsModule, AvailabilityModule, ProductivityModule, RecommendationsModule, TasksModule],
  controllers: [AiCoachController],
  providers: [AiCoachService, CoachToolsService],
})
export class AiCoachModule {}
