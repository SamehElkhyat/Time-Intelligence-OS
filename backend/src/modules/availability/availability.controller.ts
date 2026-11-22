import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '@/common/http/decorators';
import {
  AvailabilityDayDto,
  AvailabilityRangeDayDto,
  ConflictDto,
  DayQueryDto,
  RangeQueryDto,
  SlotDto,
  SlotQueryDto,
} from './availability.dto';
import { AvailabilityService } from './availability.service';

@ApiTags('availability')
@ApiCookieAuth()
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly service: AvailabilityService) {}

  @Get('day')
  @ApiOperation({
    summary: 'Smart availability for one local day',
    description:
      'Free windows with explicit confidence, schedule conflicts, and a classification of the whole day. ' +
      'Past time without tracking data is reported as UNKNOWN and is never counted as free.',
  })
  day(@CurrentUser() user: AuthUser, @Query() q: DayQueryDto): Promise<AvailabilityDayDto> {
    return this.service.day(user.id, q.date);
  }

  @Get('range')
  @ApiOperation({ summary: 'Per-day availability summaries (max 31 days)' })
  range(@CurrentUser() user: AuthUser, @Query() q: RangeQueryDto): Promise<AvailabilityRangeDayDto[]> {
    return this.service.range(user.id, q.from, q.to);
  }

  @Get('conflicts')
  @ApiOperation({ summary: 'Overlapping commitments in a date range' })
  conflicts(@CurrentUser() user: AuthUser, @Query() q: RangeQueryDto): Promise<ConflictDto[]> {
    return this.service.conflicts(user.id, q.from, q.to);
  }

  @Get('slots')
  @ApiOperation({ summary: 'Free slots that fit a given duration over the next days' })
  slots(@CurrentUser() user: AuthUser, @Query() q: SlotQueryDto): Promise<SlotDto[]> {
    return this.service.slots(user.id, q.durationMin, q.from, q.days ?? 3);
  }
}
