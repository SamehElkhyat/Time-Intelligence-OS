import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '@/common/http/decorators';
import { LeakageQueryDto, LeakageReportDto, PatternReportDto } from './productivity.dto';
import { ProductivityService } from './productivity.service';

@ApiTags('productivity')
@ApiCookieAuth()
@Controller('productivity')
export class ProductivityController {
  constructor(private readonly service: ProductivityService) {}

  @Get('leakage')
  @ApiOperation({
    summary: 'Time leakage insights',
    description: 'Explainable findings with evidence. Rest and leisure are never reported as waste; time without data is reported as unknown.',
  })
  leakage(@CurrentUser() user: AuthUser, @Query() q: LeakageQueryDto): Promise<LeakageReportDto> {
    return this.service.leakage(user.id, q.from, q.to);
  }

  @Get('patterns')
  @ApiOperation({
    summary: 'Personal productivity patterns and a forecast for today',
    description: 'Descriptive statistics over the last 8 weeks. Each insight carries sample size, data sufficiency and confidence.',
  })
  patterns(@CurrentUser() user: AuthUser): Promise<PatternReportDto> {
    return this.service.patterns(user.id);
  }
}
