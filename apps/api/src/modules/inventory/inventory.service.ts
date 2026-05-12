import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CustodyType, CylinderState } from '@prisma/client';

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService) {}

  forStore(storeId: string) {
    return this.prisma.inventoryLot.findMany({
      where: { holderType: CustodyType.STORE, holderId: storeId },
    });
  }

  forDistributor(distributorId: string) {
    return this.prisma.inventoryLot.findMany({
      where: { distributorId },
    });
  }

  forVehicle(vehicleId: string) {
    return this.prisma.inventoryLot.findMany({
      where: { holderType: CustodyType.VEHICLE, holderId: vehicleId },
    });
  }

  async fullCountForOrderLine(opts: {
    storeId: string;
    distributorId: string;
    cylinderTypeId: string;
  }) {
    const lot = await this.prisma.inventoryLot.findUnique({
      where: {
        inventory_unique: {
          holderType: CustodyType.STORE,
          holderId: opts.storeId,
          distributorId: opts.distributorId,
          cylinderTypeId: opts.cylinderTypeId,
          state: CylinderState.FULL,
        },
      },
    });
    return lot?.count ?? 0;
  }
}
