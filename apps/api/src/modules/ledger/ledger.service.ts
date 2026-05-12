import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerEntryType } from '@prisma/client';

@Injectable()
export class LedgerService {
  constructor(private prisma: PrismaService) {}

  listForDistributor(distributorId: string) {
    return this.prisma.ledgerEntry.findMany({
      where: { distributorId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async balanceOf(distributorId: string) {
    const d = await this.prisma.distributor.findUnique({ where: { id: distributorId } });
    return { balancePaisa: d?.advanceBalancePaisa ?? 0n };
  }

  async debitForOrder(distributorId: string, orderId: string, amountPaisa: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const d = await tx.distributor.findUnique({ where: { id: distributorId } });
      const newBalance = (d?.advanceBalancePaisa ?? 0n) - amountPaisa;
      await tx.distributor.update({
        where: { id: distributorId },
        data: { advanceBalancePaisa: newBalance },
      });
      return tx.ledgerEntry.create({
        data: {
          distributorId,
          entryType: LedgerEntryType.DEBIT_ORDER,
          amountPaisa: -amountPaisa,
          balanceAfterPaisa: newBalance,
          orderId,
        },
      });
    });
  }
}
