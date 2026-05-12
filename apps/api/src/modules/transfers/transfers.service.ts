import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TransferStatus } from '@prisma/client';

@Injectable()
export class TransfersService {
  constructor(private prisma: PrismaService) {}

  list() {
    return this.prisma.transfer.findMany({
      orderBy: { createdAt: 'desc' },
      include: { fromStore: true, toStore: true, vehicle: true, lines: true },
    });
  }

  create(input: {
    fromStoreId: string;
    toStoreId: string;
    cylinderIds: string[];
    vehicleId?: string;
    requestedBy: string;
  }) {
    return this.prisma.transfer.create({
      data: {
        fromStoreId: input.fromStoreId,
        toStoreId: input.toStoreId,
        vehicleId: input.vehicleId,
        requestedBy: input.requestedBy,
        status: TransferStatus.REQUESTED,
        lines: { create: input.cylinderIds.map((cid) => ({ cylinderId: cid })) },
      },
      include: { lines: true },
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
}
