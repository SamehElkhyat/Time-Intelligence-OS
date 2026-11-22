import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '@/common/http/decorators';
import {
  AcceptResultDto,
  GenerateRecommendationsDto,
  NextActionDto,
  RecommendationBatchDto,
  RecommendationDto,
} from './recommendations.dto';
import { RecommendationsService } from './recommendations.service';

@ApiTags('recommendations')
@ApiCookieAuth()
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly service: RecommendationsService) {}

  @Post('generate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rank open tasks against real availability',
    description:
      'Transparent weighted scoring (urgency, priority, fit, energy, focus, time of day, history, momentum, leverage). ' +
      'Every recommendation carries its factor breakdown and reasons; tasks that were not recommended are listed with why.',
  })
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateRecommendationsDto): Promise<RecommendationBatchDto> {
    return this.service.generate(user.id, dto);
  }

  @Get('latest')
  @ApiOperation({ summary: 'Most recent open batch' })
  latest(@CurrentUser() user: AuthUser): Promise<RecommendationBatchDto> {
    return this.service.latest(user.id);
  }

  @Post('next')
  @HttpCode(200)
  @ApiOperation({ summary: 'Best next action (reuses a batch younger than 5 minutes, otherwise regenerates)' })
  next(@CurrentUser() user: AuthUser): Promise<NextActionDto> {
    return this.service.next(user.id);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept: schedule the task into the suggested window' })
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<AcceptResultDto> {
    return this.service.accept(user.id, id);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  dismiss(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<RecommendationDto> {
    return this.service.dismiss(user.id, id);
  }
}
