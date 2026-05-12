import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Returns are tracked via cylinder_events (PICKED_UP_EMPTY → RETURNED_TO_DISTRIBUTOR).
 * This module surfaces queries against those events, and lets ops trigger
 * end-of-day return drops from a store to a distributor.
 */
@Injectable()
export class ReturnsService {
  constructor(private prisma: PrismaService) {}

  pendingForDistributor(distributorId: string) {
    return this.prisma.cylinder.count({
      where: { distributorId, state: 'EMPTY', custodyType: 'STORE' },
    });
  }

  emptiesAtStoreByDistributor(storeId: string) {
    return this.prisma.inventoryLot.findMany({
      where: { holderType: 'STORE', holderId: storeId, state: 'EMPTY' },
    });
  }
}
