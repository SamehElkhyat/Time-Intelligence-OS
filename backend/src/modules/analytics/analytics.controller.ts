import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '@/common/http/decorators';
import {
  AnalyticsSummaryDto,
  DailyAnalyticsDto,
  DashboardDto,
  DateQueryDto,
  MonthlyReportQueryDto,
  RangeDto,
  ReportDto,
  WeeklyReportQueryDto,
} from './analytics.dto';
import { AnalyticsService } from './analytics.service';

@ApiTags('analytics')
@ApiCookieAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Daily command center: every metric is computed from stored plans and tracked time' })
  dashboard(@CurrentUser() user: AuthUser, @Query() q: DateQueryDto): Promise<DashboardDto> {
    return this.service.dashboard(user.id, q.date);
  }

  @Get('daily')
  @ApiOperation({ summary: 'Daily analytics rows for a date range' })
  daily(@CurrentUser() user: AuthUser, @Query() q: RangeDto): Promise<DailyAnalyticsDto[]> {
    return this.service.dailyRows(user.id, q.from, q.to);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Aggregated analytics: totals, category distribution, planned vs actual, heatmap' })
  summary(@CurrentUser() user: AuthUser, @Query() q: RangeDto): Promise<AnalyticsSummaryDto> {
    return this.service.summary(user.id, q.from, q.to);
  }

  @Get('reports/weekly')
  @ApiOperation({ summary: 'Weekly report with comparison to the previous week' })
  weekly(@CurrentUser() user: AuthUser, @Query() q: WeeklyReportQueryDto): Promise<ReportDto> {
    return this.service.weeklyReport(user.id, q.date);
  }

  @Get('reports/monthly')
  @ApiOperation({ summary: 'Monthly report with comparison to the previous month' })
  monthly(@CurrentUser() user: AuthUser, @Query() q: MonthlyReportQueryDto): Promise<ReportDto> {
    return this.service.monthlyReport(user.id, q.month);
  }
}
