import { Injectable } from '@nestjs/common';
import { UserRole, type CustodyType } from '@prisma/client';
import type { CylinderEventSource, CylinderEventTypeValue, CylinderHistoryDto, CylinderStateValue } from '@smartfleet/shared-types';
import type { UserActor } from '../../common/auth/actor';
import { canSeeCylinder } from '../../common/auth/policies';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { refillShortCode } from '../filling-orders/refill.mapper';
import { orderShortCode } from '../orders/orders.mapper';
import { sizeLabelOf } from '../pricing/size-label';
import { cylinderShortCode, resolveQrOrFullNumber, resolveQrOrNumber } from './cylinder-codes';
import { holderLabels, labelOf, shownHolderType } from './holders';
import { responsibleDriver } from './responsible';

/** The station a refill filled at: the station's name, or the shop's own station (Inc 1 own-service refills). */
function stationOf(refill: { ownStationName: string | null; fillingStation: { name: string } | null } | null): { name: string } | null {
  const name = refill?.fillingStation?.name ?? refill?.ownStationName ?? null;
  return name ? { name } : null;
}

/**
 * A cylinder's holder and its moves in time order (API_CONTRACT §9.4 `GET /cylinders/:code/history`,
 * the office's Find cylinder). The owning distributor may type `42`, `0042`, `C0042` or `AG-C0042`; the
 * office needs the QR value or the full `AG-C0042`. Another distributor's cylinder answers like an
 * unknown number (404 NOT_FOUND, `canSeeCylinder`).
 */
@Injectable()
export class CylinderHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async byCode(caller: UserActor, code: string): Promise<CylinderHistoryDto> {
    let cylinderId: string | null = null;
    if (caller.role === UserRole.DISTRIBUTOR) {
      if (!caller.distributorId) throw new AppError('PERMISSION_DENIED');
      const own = await this.prisma.distributor.findUnique({ where: { id: caller.distributorId }, select: { id: true, code: true } });
      if (!own) throw new AppError('PERMISSION_DENIED');
      cylinderId = await resolveQrOrNumber(this.prisma, code, own);
    } else {
      cylinderId = await resolveQrOrFullNumber(this.prisma, code);
    }
    const owner = cylinderId ? await this.prisma.cylinder.findUnique({ where: { id: cylinderId }, select: { id: true, distributorId: true } }) : null;
    canSeeCylinder(caller, owner);
    return this.build(cylinderId as string);
  }

  private async build(cylinderId: string): Promise<CylinderHistoryDto> {
    const cylinder = await this.prisma.cylinder.findUniqueOrThrow({
      where: { id: cylinderId },
      select: {
        id: true,
        qrCode: true,
        shortNo: true,
        state: true,
        custodyType: true,
        custodyId: true,
        lastEventId: true,
        cylinderType: { select: { id: true, name: true, weightKg: true } },
        distributor: { select: { code: true } },
      },
    });
    const rows = await this.prisma.cylinderEvent.findMany({
      where: { cylinderId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        eventType: true,
        source: true,
        fromCustodyType: true,
        fromCustodyId: true,
        toCustodyType: true,
        toCustodyId: true,
        reason: true,
        orderId: true,
        fillingOrderId: true,
        toState: true,
        createdAt: true,
        actor: { select: { name: true, role: true } },
        stopCylinder: { select: { returnState: true, direction: true } },
        // [Inc 3] The station of a fill, and the day-end that made a fix or registered the cylinder.
        fillingOrder: { select: { ownStationName: true, fillingStation: { select: { name: true } } } },
        dayCloseLine: { select: { dayClose: { select: { businessDate: true } } } },
      },
    });
    // The cylinder's own last move is the newest, whatever the clock says (moves can share a millisecond).
    const events = cylinder.lastEventId
      ? [...rows.filter((row) => row.id !== cylinder.lastEventId), ...rows.filter((row) => row.id === cylinder.lastEventId)]
      : rows;
    const holders = events.flatMap((event) => [
      event.fromCustodyType && event.fromCustodyId ? { type: event.fromCustodyType, id: event.fromCustodyId } : null,
      event.toCustodyType && event.toCustodyId ? { type: event.toCustodyType, id: event.toCustodyId } : null,
    ]);
    const current = { type: cylinder.custodyType, id: cylinder.custodyId };
    const [labels, orders, refills, responsible] = await Promise.all([
      holderLabels(this.prisma, [...holders, current]),
      this.orderCodes(events.map((event) => event.orderId)),
      this.refillCodes(events.map((event) => event.fillingOrderId)),
      responsibleDriver(this.prisma, cylinderId),
    ]);
    const ref = (type: CustodyType | null, id: string | null) => (type && id ? { type, id } : null);
    const last = events[events.length - 1];
    return {
      cylinder: {
        id: cylinder.id,
        code: cylinder.qrCode,
        shortNo: cylinder.shortNo,
        shortCode: cylinderShortCode(cylinder.distributor.code, cylinder.shortNo),
        size: { id: cylinder.cylinderType.id, label: sizeLabelOf(cylinder.cylinderType) },
        state: cylinder.state as CylinderStateValue,
      },
      holder: {
        type: shownHolderType(current.type),
        label: labelOf(labels, current) ?? '',
        since: last ? last.createdAt.toISOString() : null,
        responsible: responsible ? { userId: responsible.userId, name: responsible.name, role: 'DRIVER' } : null,
      },
      events: events.map((event) => ({
        at: event.createdAt.toISOString(),
        action: event.eventType as CylinderEventTypeValue,
        from: labelOf(labels, ref(event.fromCustodyType, event.fromCustodyId)),
        to: labelOf(labels, ref(event.toCustodyType, event.toCustodyId)),
        actor: { name: event.actor.name, role: event.actor.role },
        order: event.orderId && orders.has(event.orderId) ? { shortCode: orders.get(event.orderId) as string } : null,
        // [Inc 3] A refill pickup, fill or receive names its refill (G06-06).
        refill: event.fillingOrderId && refills.has(event.fillingOrderId) ? { shortCode: refills.get(event.fillingOrderId) as string } : null,
        source: event.source as CylinderEventSource,
        returnState: event.stopCylinder?.direction === 'TAKEN_BACK' ? ((event.stopCylinder.returnState as CylinderStateValue | null) ?? null) : null,
        reason: event.reason,
        toState: (event.toState as CylinderStateValue | null) ?? null,
        station: event.eventType === 'FILLED' ? stationOf(event.fillingOrder) : null,
        dayEnd: event.dayCloseLine ? { businessDate: event.dayCloseLine.dayClose.businessDate.toISOString().slice(0, 10) } : null,
      })),
    };
  }

  /** [Inc 3] The refills' numbers (AG-R007), by id. */
  private async refillCodes(ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (wanted.length === 0) return new Map();
    const refills = await this.prisma.fillingOrder.findMany({
      where: { id: { in: wanted } },
      select: { id: true, refillNo: true, distributor: { select: { code: true } } },
    });
    const out = new Map<string, string>();
    for (const refill of refills) {
      const code = refillShortCode(refill.distributor.code, refill.refillNo);
      if (code) out.set(refill.id, code);
    }
    return out;
  }

  private async orderCodes(ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (wanted.length === 0) return new Map();
    const orders = await this.prisma.order.findMany({
      where: { id: { in: wanted } },
      select: { id: true, orderNo: true, distributor: { select: { code: true } } },
    });
    return new Map(orders.map((order) => [order.id, orderShortCode(order.distributor.code, order.orderNo)]));
  }
}
