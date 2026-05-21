import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TransferStatus } from '@prisma/client';

@Injectable()
export class TransfersService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.transfer.findMany({
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'desc' }],
      include: {
        fromStore: true,
        toStore: true,
        vehicle: true,
        driver: { include: { user: true } },
        lines: true,
      },
    });
  }

  // Stock summary for a "from store": full + empty counts grouped by distributor × cylinder type.
  // Drives the roll-plan UI so the operator can see what's available before scheduling a transfer.
  async stockSummary(storeId: string) {
    const rows: Array<{
      distributor_id: string;
      distributor_name: string;
      cylinder_type_id: string;
      cylinder_type_code: string;
      cylinder_type_name: string;
      state: 'FULL' | 'EMPTY';
      count: number;
    }> = await this.prisma.$queryRaw`
      SELECT d.id AS distributor_id, d.business_name AS distributor_name,
             ct.id AS cylinder_type_id, ct.code AS cylinder_type_code, ct.name AS cylinder_type_name,
             il.state AS state,
             SUM(il.count)::int AS count
      FROM inventory_lots il
      JOIN distributors d ON d.id = il.distributor_id
      JOIN cylinder_types ct ON ct.id = il.cylinder_type_id
      WHERE il.holder_type = 'STORE'
        AND il.holder_id = ${storeId}::uuid
        AND il.count > 0
      GROUP BY d.id, d.business_name, ct.id, ct.code, ct.name, il.state
      ORDER BY d.business_name, ct.name, il.state
    `;
    return rows;
  }

  create(input: {
    fromStoreId: string;
    toStoreId: string;
    cylinderIds: string[];
    vehicleId?: string;
    driverId?: string;
    scheduledFor?: string;
    notes?: string;
    requestedBy: string;
  }) {
    return this.prisma.transfer.create({
      data: {
        fromStoreId: input.fromStoreId,
        toStoreId: input.toStoreId,
        vehicleId: input.vehicleId,
        driverId: input.driverId,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : undefined,
        notes: input.notes,
        requestedBy: input.requestedBy,
        status: TransferStatus.REQUESTED,
        lines: { create: input.cylinderIds.map((cid) => ({ cylinderId: cid })) },
      },
      include: {
        lines: true,
        fromStore: true,
        toStore: true,
        driver: { include: { user: true } },
      },
    });
  }

  setStatus(id: string, status: TransferStatus) {
    return this.prisma.transfer.update({
      where: { id },
      data: {
        status,
        completedAt: status === TransferStatus.COMPLETED ? new Date() : undefined,
      },
    });
  }

  // Driver app: scheduled/in-flight transfers assigned to the signed-in driver.
  listForDriver(driverId: string) {
    return this.prisma.transfer.findMany({
      where: {
        driverId,
        status: { in: [TransferStatus.REQUESTED, TransferStatus.IN_TRANSIT] },
      },
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'asc' }],
      include: { fromStore: true, toStore: true, lines: true },
    });
  }
}
