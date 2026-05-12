import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ReconciliationStatus } from '@prisma/client';

@Injectable()
export class ReconciliationService {
  constructor(private prisma: PrismaService) {}

  submit(input: {
    driverId: string;
    forDate: string;
    submittedCashPaisa: number;
    cylindersDelivered: number;
    cylindersReturned: number;
  }) {
    return this.prisma.reconciliation.upsert({
      where: {
        driverId_forDate: { driverId: input.driverId, forDate: new Date(input.forDate) },
      },
      update: {
        submittedCashPaisa: BigInt(input.submittedCashPaisa),
        cylindersDelivered: input.cylindersDelivered,
        cylindersReturned: input.cylindersReturned,
        status: ReconciliationStatus.PENDING,
      },
      create: {
        driverId: input.driverId,
        forDate: new Date(input.forDate),
        submittedCashPaisa: BigInt(input.submittedCashPaisa),
        expectedCashPaisa: 0n, // computed by job
        cylindersDelivered: input.cylindersDelivered,
        cylindersReturned: input.cylindersReturned,
      },
    });
  }

  verify(id: string, verifiedByUserId: string, status: ReconciliationStatus, note?: string) {
    return this.prisma.reconciliation.update({
      where: { id },
      data: { status, verifiedByUserId, note },
    });
  }

  pending() {
    return this.prisma.reconciliation.findMany({
      where: { status: ReconciliationStatus.PENDING },
      include: { driver: true },
    });
  }
}
