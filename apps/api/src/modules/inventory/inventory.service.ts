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

  // Aggregated view used by admin "Track inventory" screen.
  async byStore() {
    return this.prisma.$queryRaw<
      Array<{
        store_id: string;
        store_name: string;
        distributor_id: string;
        distributor_name: string;
        cylinder_type_id: string;
        cylinder_type_code: string;
        state: CylinderState;
        count: number;
      }>
    >`
      SELECT s.id AS store_id, s.name AS store_name,
             d.id AS distributor_id, d.business_name AS distributor_name,
             ct.id AS cylinder_type_id, ct.code AS cylinder_type_code,
             il.state, il.count
      FROM inventory_lots il
      JOIN stores s ON s.id = il.holder_id AND il.holder_type = 'STORE'
      JOIN distributors d ON d.id = il.distributor_id
      JOIN cylinder_types ct ON ct.id = il.cylinder_type_id
      WHERE il.count > 0
      ORDER BY s.name, d.business_name, ct.code, il.state
    `;
  }

  // For distributor mobile: aggregated inventory by holder.
  async breakdownForDistributor(distributorId: string) {
    const lots = await this.prisma.inventoryLot.findMany({
      where: { distributorId },
    });
    const [types, stores, vehicles] = await Promise.all([
      this.prisma.cylinderType.findMany(),
      this.prisma.store.findMany(),
      this.prisma.vehicle.findMany(),
    ]);
    const typeMap = new Map(types.map((t) => [t.id, t]));
    const storeMap = new Map(stores.map((s) => [s.id, s.name]));
    const vehicleMap = new Map(vehicles.map((v) => [v.id, v.plateNo]));

    return lots.map((l) => ({
      holderType: l.holderType,
      holderId: l.holderId,
      holderLabel:
        l.holderType === 'STORE'
          ? storeMap.get(l.holderId) ?? l.holderId
          : l.holderType === 'VEHICLE'
            ? vehicleMap.get(l.holderId) ?? l.holderId
            : l.holderId,
      cylinderTypeCode: typeMap.get(l.cylinderTypeId)?.code ?? l.cylinderTypeId,
      state: l.state,
      count: l.count,
    }));
  }
}
