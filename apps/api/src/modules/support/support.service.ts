import { Injectable } from '@nestjs/common';
import { TicketStatus, UserRole } from '@prisma/client';
import type { CreateTicketInput } from '@smartfleet/shared-validation';
import type { AuthContext } from '../../common/decorators/current-user.decorator';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Support tickets (switched off for the pilot, `features.support`). When on: anyone signed in opens a
 * ticket; the office sees every ticket and changes their status, other users see only their own.
 */
@Injectable()
export class SupportService {
  constructor(private prisma: PrismaService) {}

  create(reporter: AuthContext, input: CreateTicketInput) {
    return this.prisma.supportTicket.create({
      data: {
        reporterUserId: reporter.userId,
        subject: input.subject,
        body: input.body,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        priority: input.priority ?? 3,
      },
    });
  }

  list(caller: AuthContext, status?: TicketStatus) {
    return this.prisma.supportTicket.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(caller.role === UserRole.SUPER_ADMIN ? {} : { reporterUserId: caller.userId }),
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  async setStatus(id: string, status: TicketStatus) {
    const ticket = UUID.test(id) ? await this.prisma.supportTicket.findUnique({ where: { id }, select: { id: true } }) : null;
    if (!ticket) throw new AppError('NOT_FOUND');
    return this.prisma.supportTicket.update({ where: { id }, data: { status } });
  }
}
