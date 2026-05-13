import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertSeverity, AlertStatus, AlertType, Prisma } from '@prisma/client';

@Injectable()
export class AlertsService {
  constructor(private prisma: PrismaService) {}

  list(opts: { status?: AlertStatus; severity?: AlertSeverity } = {}) {
    return this.prisma.alert.findMany({
      where: {
        status: opts.status,
        severity: opts.severity,
      },
      orderBy: [{ severity: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  unreadCount() {
    return this.prisma.alert.count({ where: { status: AlertStatus.OPEN } });
  }

  raise(input: {
    alertType: AlertType;
    severity?: AlertSeverity;
    title: string;
    body: string;
    resourceType?: string;
    resourceId?: string;
    context?: Prisma.InputJsonValue;
    dedupeKey?: { resourceType?: string; resourceId?: string; alertType: AlertType };
  }) {
    // Dedup: if an OPEN alert already exists for the same resource+type, reuse it
    if (input.dedupeKey) {
      return this.prisma.$transaction(async (tx) => {
        const existing = await tx.alert.findFirst({
          where: {
            alertType: input.dedupeKey!.alertType,
            resourceType: input.dedupeKey!.resourceType,
            resourceId: input.dedupeKey!.resourceId,
            status: AlertStatus.OPEN,
          },
        });
        if (existing) {
          return tx.alert.update({
            where: { id: existing.id },
            data: { updatedAt: new Date(), context: input.context },
          });
        }
        return tx.alert.create({
          data: {
            alertType: input.alertType,
            severity: input.severity ?? AlertSeverity.WARNING,
            title: input.title,
            body: input.body,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            context: input.context,
          },
        });
      });
    }
    return this.prisma.alert.create({
      data: {
        alertType: input.alertType,
        severity: input.severity ?? AlertSeverity.WARNING,
        title: input.title,
        body: input.body,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        context: input.context,
      },
    });
  }

  acknowledge(id: string) {
    return this.prisma.alert.update({
      where: { id },
      data: { status: AlertStatus.ACKNOWLEDGED, acknowledgedAt: new Date() },
    });
  }

  resolve(id: string) {
    return this.prisma.alert.update({
      where: { id },
      data: { status: AlertStatus.RESOLVED, resolvedAt: new Date() },
    });
  }
}
