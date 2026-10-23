import { Injectable } from '@nestjs/common';
import { CustodyType, CylinderEventType, CylinderState } from '@prisma/client';
import type { CylinderStateValue, SizeCount, StoreIncomingDto, StoreStockDto } from '@smartfleet/shared-types';
import type { UserActor } from '../../common/auth/actor';
import { ownDistributorId } from '../../common/auth/own-driver-id';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { currentBusinessDays } from '../orders/support/business-day';
import { SettingsService } from '../settings/settings.service';
import { sizeLabels } from './holders';
import { vanCylinders } from './van';

const ALL_STATES: CylinderStateValue[] = ['FULL', 'EMPTY', 'PART_FILLED', 'FAULTY', 'LOST'];

/**
 * The shop app's store views (API_CONTRACT §9.4), counted from cylinders, never from inventory lots.
 * Every figure is the caller's own: its cylinders on any van, and its one store.
 */
@Injectable()
export class StoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * `GET /store/incoming`: the caller's cylinders on any van, one row per van, each cylinder with why it
   * is coming back (`came`). `counts.received` is what the store has received from that van in the
   * current business day; `total` is that plus what is still on the van, so "{{done}} of {{total}}
   * received" reads right. Vans with nothing left aren't listed, and unlabelled returns never appear.
   */
  async incoming(actor: UserActor): Promise<StoreIncomingDto> {
    const distributorId = ownDistributorId(actor);
    const store = await this.homeStore(distributorId);
    const vans = await this.prisma.cylinder.groupBy({
      by: ['custodyId'],
      where: { custodyType: CustodyType.VEHICLE, distributorId },
    });
    if (vans.length === 0) return { vans: [] };
    const today = await currentBusinessDays(this.settings);
    const vehicles = await this.prisma.vehicle.findMany({
      where: { id: { in: vans.map((van) => van.custodyId) } },
      select: { id: true, plateNo: true, currentDriver: { select: { id: true, user: { select: { name: true, phone: true } } } } },
    });
    const rows: StoreIncomingDto['vans'] = [];
    for (const vehicle of vehicles) {
      const cylinders = await vanCylinders(this.prisma, vehicle.id, { distributorId });
      if (cylinders.length === 0) continue;
      const received = await this.prisma.cylinderEvent.findMany({
        where: {
          eventType: CylinderEventType.SCAN_IN,
          fromCustodyType: CustodyType.VEHICLE,
          fromCustodyId: vehicle.id,
          toCustodyType: CustodyType.STORE,
          toCustodyId: store.id,
          createdAt: { gte: today.start, lt: today.end },
          cylinder: { distributorId },
        },
        select: { cylinderId: true, cylinder: { select: { cylinderTypeId: true } } },
        distinct: ['cylinderId'],
      });
      const latest = cylinders
        .filter((cylinder) => cylinder.tripId && cylinder.since)
        .sort((a, b) => (b.since as Date).getTime() - (a.since as Date).getTime())[0];
      const trip = latest?.tripId
        ? await this.prisma.trip.findUnique({
            where: { id: latest.tripId },
            select: { id: true, status: true, driver: { select: { id: true, user: { select: { name: true, phone: true } } } } },
          })
        : null;
      const driver = trip?.driver ?? vehicle.currentDriver ?? null;
      const bySizeCount = new Map<string, number>();
      for (const cylinder of cylinders) bySizeCount.set(cylinder.cylinderTypeId, (bySizeCount.get(cylinder.cylinderTypeId) ?? 0) + 1);
      for (const row of received) bySizeCount.set(row.cylinder.cylinderTypeId, (bySizeCount.get(row.cylinder.cylinderTypeId) ?? 0) + 1);
      rows.push({
        vehicle: { id: vehicle.id, plateNo: vehicle.plateNo },
        driver: driver ? { id: driver.id, name: driver.user.name, phone: driver.user.phone } : null,
        trip: trip ? { id: trip.id, status: trip.status } : null,
        cylinders: cylinders.map((cylinder) => ({
          shortCode: cylinder.shortNo === null ? null : cylinder.shortCode,
          sizeLabel: cylinder.sizeLabel,
          state: cylinder.state,
          came: cylinder.came,
          from: cylinder.from,
          refill: null,
        })),
        counts: { total: cylinders.length + received.length, received: received.length, bySize: await this.sizeCounts(bySizeCount) },
      });
    }
    rows.sort((a, b) => a.vehicle.plateNo.localeCompare(b.vehicle.plateNo));
    return { vans: rows };
  }

  /** `GET /store/stock`: the caller's cylinders in its store, by size and state. */
  async stock(actor: UserActor): Promise<StoreStockDto> {
    const distributorId = ownDistributorId(actor);
    const store = await this.homeStore(distributorId);
    const groups = await this.prisma.cylinder.groupBy({
      by: ['cylinderTypeId', 'state'],
      where: { custodyType: CustodyType.STORE, custodyId: store.id, distributorId },
      _count: { _all: true },
    });
    const sizes = await sizeLabels(this.prisma, groups.map((group) => group.cylinderTypeId));
    const byType = new Map<string, StoreStockDto['sizes'][number]>();
    for (const group of groups) {
      const row =
        byType.get(group.cylinderTypeId) ??
        ({
          cylinderTypeId: group.cylinderTypeId,
          sizeLabel: sizes.get(group.cylinderTypeId)?.label ?? '',
          total: 0,
          byState: Object.fromEntries(ALL_STATES.map((state) => [state, 0])) as Record<CylinderStateValue, number>,
        } satisfies StoreStockDto['sizes'][number]);
      row.byState[group.state as CylinderState as CylinderStateValue] += group._count._all;
      row.total += group._count._all;
      byType.set(group.cylinderTypeId, row);
    }
    const out = [...byType.values()].sort(
      (a, b) => (sizes.get(a.cylinderTypeId)?.weightKg ?? 0) - (sizes.get(b.cylinderTypeId)?.weightKg ?? 0),
    );
    return { total: out.reduce((sum, row) => sum + row.total, 0), sizes: out };
  }

  private async homeStore(distributorId: string): Promise<{ id: string }> {
    const distributor = await this.prisma.distributor.findUnique({ where: { id: distributorId }, select: { homeStoreId: true } });
    if (!distributor) throw new AppError('PERMISSION_DENIED');
    return { id: distributor.homeStoreId };
  }

  private async sizeCounts(counts: Map<string, number>): Promise<SizeCount[]> {
    const sizes = await sizeLabels(this.prisma, [...counts.keys()]);
    return [...counts.entries()]
      .map(([typeId, count]) => ({ cylinderTypeId: typeId, sizeLabel: sizes.get(typeId)?.label ?? '', count }))
      .sort((a, b) => (sizes.get(a.cylinderTypeId)?.weightKg ?? 0) - (sizes.get(b.cylinderTypeId)?.weightKg ?? 0));
  }
}
