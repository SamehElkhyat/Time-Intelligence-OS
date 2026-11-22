import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '@/common/http/decorators';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { QueueService, QueueStats } from '@/infrastructure/queue/queue.service';
import { RedisService } from '@/infrastructure/redis/redis.service';

export class LivenessDto {
  status: string;
  uptimeSec: number;
}

class DependencyDto {
  /** "up", "down", or "disabled" when the dependency is optional and not configured. */
  @ApiProperty({ enum: ['up', 'down', 'disabled'] }) status: string;
}

export class ReadinessDto {
  @ApiProperty({ enum: ['ok', 'degraded'] }) status: string;
  database: DependencyDto;
  redis: DependencyDto;
  queue: QueueStats;
}

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly queue: QueueService,
  ) {}

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness: the process is running' })
  live(): LivenessDto {
    return { status: 'ok', uptimeSec: Math.round(process.uptime()) };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness: database (required), Redis (optional) and job queue statistics' })
  async ready(): Promise<ReadinessDto> {
    const [db, redis, queue] = await Promise.all([this.prisma.isHealthy(), this.redis.isHealthy(), this.queue.stats().catch(() => null)]);
    const body = {
      status: db && redis !== false ? 'ok' : 'degraded',
      database: { status: db ? 'up' : 'down' },
      redis: { status: redis === null ? 'disabled' : redis ? 'up' : 'down' },
      queue: queue ?? { mode: 'inline' as const, waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 },
    };
    if (!db) throw new HttpException(body, HttpStatus.SERVICE_UNAVAILABLE);
    return body;
  }
}
