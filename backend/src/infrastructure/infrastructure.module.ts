import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service';
import { OutboxService } from './events/outbox.service';
import { PrismaService } from './prisma/prisma.service';
import { QueueService } from './queue/queue.service';
import { RealtimeBridge } from './realtime/realtime-bridge.service';
import { RealtimeService } from './realtime/realtime.service';
import { CacheService } from './redis/cache.service';
import { RedisService } from './redis/redis.service';

/** Technical building blocks shared by every feature module. */
@Global()
@Module({
  providers: [PrismaService, RedisService, CacheService, QueueService, OutboxService, RealtimeService, RealtimeBridge, AuditService],
  exports: [PrismaService, RedisService, CacheService, QueueService, OutboxService, RealtimeService, AuditService],
})
export class InfrastructureModule {}
