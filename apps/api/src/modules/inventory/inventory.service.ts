import { Injectable } from '@nestjs/common';
import type { CylinderStateValue, MyVehicleLoadDto, VanCylinderCode } from '@smartfleet/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { CustodyType, CylinderState } from '@prisma/client';
import { cylinderShortCode } from '../custody/cylinder-codes';

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

  /**
   * What is on a van by size, counted from the cylinders themselves (Inc 2, API_CONTRACT Appendix A:
   * `GET /inventory/my-vehicle` is "counted from cylinders"), never from the legacy lots. The shape the
   * installed VehicleLoad screen reads is kept; `partFilled` is added (a taken-back part-filled cylinder):
   *   { vehicleId, plateNo, totalFull, totalEmpty, totalPartFilled, byType: [
   *       { cylinderTypeId, code, name, full, empty, partFilled } ] }
   * Damaged or lost cylinders on the van count in none of the three.
   */
  async vehicleSummary(vehicleId: string) {
    const vehicle = await this.prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { id: true, plateNo: true },
    });
    const [summary] = await this.summaries([vehicleId]);
    return {
      vehicleId: vehicle?.id ?? vehicleId,
      plateNo: vehicle?.plateNo ?? null,
      totalFull: summary?.totalFull ?? 0,
      totalEmpty: summary?.totalEmpty ?? 0,
      totalPartFilled: summary?.totalPartFilled ?? 0,
      byType: summary?.byType ?? [],
    };
  }

  /**
   * Fleet-wide load for the office: every van holding cylinders, with full, empty and part-filled per
   * size, counted from the cylinders. Vans with nothing on them are left out.
   */
  async allVehiclesSummary() {
    const vans = await this.prisma.cylinder.groupBy({ by: ['custodyId'], where: { custodyType: CustodyType.VEHICLE } });
    const summaries = await this.summaries(vans.map((van) => van.custodyId));
    return summaries.filter((summary) => summary.byType.length > 0).sort((a, b) => (a.plateNo ?? '').localeCompare(b.plateNo ?? ''));
  }

  private async summaries(vehicleIds: string[]) {
    if (vehicleIds.length === 0) return [];
    const [groups, vehicles] = await Promise.all([
      this.prisma.cylinder.groupBy({
        by: ['custodyId', 'cylinderTypeId', 'state'],
        where: { custodyType: CustodyType.VEHICLE, custodyId: { in: vehicleIds } },
        _count: { _all: true },
      }),
      this.prisma.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, plateNo: true } }),
    ]);
    const typeIds = [...new Set(groups.map((group) => group.cylinderTypeId))];
    const types = typeIds.length ? await this.prisma.cylinderType.findMany({ where: { id: { in: typeIds } } }) : [];
    const typeMap = new Map(types.map((t) => [t.id, t]));
    const plates = new Map(vehicles.map((v) => [v.id, v.plateNo]));
    return vehicleIds.map((vehicleId) => {
      const byTypeMap = new Map<string, { cylinderTypeId: string; code: string; name: string; full: number; empty: number; partFilled: number }>();
      for (const group of groups.filter((g) => g.custodyId === vehicleId)) {
        const t = typeMap.get(group.cylinderTypeId);
        const row = byTypeMap.get(group.cylinderTypeId) ?? {
          cylinderTypeId: group.cylinderTypeId,
          code: t?.code ?? '?',
          name: t?.name ?? 'Unknown',
          full: 0,
          empty: 0,
          partFilled: 0,
        };
        const n = group._count._all;
        if (group.state === CylinderState.FULL) row.full += n;
        else if (group.state === CylinderState.EMPTY) row.empty += n;
        else if (group.state === CylinderState.PART_FILLED) row.partFilled += n;
        byTypeMap.set(group.cylinderTypeId, row);
      }
      const byType = [...byTypeMap.values()]
        .filter((r) => r.full > 0 || r.empty > 0 || r.partFilled > 0)
        .sort((a, b) => a.code.localeCompare(b.code));
      return {
        vehicleId,
        plateNo: plates.get(vehicleId) ?? null,
        totalFull: byType.reduce((sum, r) => sum + r.full, 0),
        totalEmpty: byType.reduce((sum, r) => sum + r.empty, 0),
        totalPartFilled: byType.reduce((sum, r) => sum + r.partFilled, 0),
        byType,
      };
    });
  }

  /**
   * The signed-in driver's current van (`GET /inventory/my-vehicle`): the counts by size, plus each
   * cylinder on it by number (Inc 2, My van's numbers line "AG-C0001, AG-C0002").
   */
  async forMyVehicle(userId: string): Promise<MyVehicleLoadDto> {
    const driver = await this.prisma.driver.findFirst({
      where: { userId },
      select: { currentVehicleId: true },
    });
    if (!driver?.currentVehicleId) {
      return { vehicleId: null, plateNo: null, totalFull: 0, totalEmpty: 0, totalPartFilled: 0, byType: [], cylinders: [], noVehicle: true };
    }
    const [summary, cylinders] = await Promise.all([
      this.vehicleSummary(driver.currentVehicleId),
      this.vanCylinderCodes(driver.currentVehicleId),
    ]);
    return { ...summary, cylinders };
  }

  /** Every cylinder on a van by its number (AG-C0042, or the QR value without one), lowest number first. */
  private async vanCylinderCodes(vehicleId: string): Promise<VanCylinderCode[]> {
    const rows = await this.prisma.cylinder.findMany({
      where: { custodyType: CustodyType.VEHICLE, custodyId: vehicleId },
      select: { qrCode: true, shortNo: true, cylinderTypeId: true, state: true, distributor: { select: { code: true } } },
      orderBy: [{ shortNo: 'asc' }, { qrCode: 'asc' }],
    });
    return rows.map((row) => ({
      shortCode: cylinderShortCode(row.distributor.code, row.shortNo) ?? row.qrCode,
      cylinderTypeId: row.cylinderTypeId,
      state: row.state as CylinderStateValue,
    }));
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
