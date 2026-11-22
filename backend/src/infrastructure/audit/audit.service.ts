import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db, PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  userId: string | null;
  actor?: 'user' | 'system' | 'ai-coach';
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  ipAddress?: string | null;
}

const json = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined || v === null ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/** Append-only audit trail. Pass the transaction client to make the entry atomic with the change. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        userId: entry.userId,
        actor: entry.actor ?? 'user',
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: json(entry.before),
        after: json(entry.after),
        metadata: json(entry.metadata),
        ipAddress: entry.ipAddress ?? null,
      },
    });
  }

  list(userId: string, entityType: string, entityId: string, take = 50) {
    return this.prisma.auditLog.findMany({
      where: { userId, entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
