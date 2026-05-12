import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditLogService {
  constructor(private prisma: PrismaService) {}

  record(input: {
    actorUserId: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    diff?: any;
    ip?: string;
    userAgent?: string;
  }) {
    return this.prisma.auditLog.create({ data: input });
  }

  list(resourceType?: string, resourceId?: string) {
    return this.prisma.auditLog.findMany({
      where: { resourceType, resourceId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
