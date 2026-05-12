import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TicketStatus } from '@prisma/client';

@Injectable()
export class SupportService {
  constructor(private prisma: PrismaService) {}

  create(input: {
    reporterUserId: string;
    subject: string;
    body: string;
    subjectType: string;
    subjectId?: string;
    priority?: number;
  }) {
    return this.prisma.supportTicket.create({
      data: { ...input, priority: input.priority ?? 3 },
    });
  }

  list(status?: TicketStatus) {
    return this.prisma.supportTicket.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      take: 200,
    });
  }

  setStatus(id: string, status: TicketStatus) {
    return this.prisma.supportTicket.update({ where: { id }, data: { status } });
  }
}
