import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AvailabilityModule } from '../availability/availability.module';
import { ProductivityController } from './productivity.controller';
import { ProductivityService } from './productivity.service';

@Module({
  imports: [AnalyticsModule, AvailabilityModule],
  controllers: [ProductivityController],
  providers: [ProductivityService],
  exports: [ProductivityService],
})
export class ProductivityModule {}
