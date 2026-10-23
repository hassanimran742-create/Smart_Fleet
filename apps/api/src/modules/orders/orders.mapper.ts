import { Prisma, UserRole } from '@prisma/client';
import type { DeliveryFailureReason, DeliveryStartedRule, OrderCancelReason, OrderDto, OrderFeeLineDto } from '@smartfleet/shared-types';
import { deriveOrderStage, formatNo } from '@smartfleet/shared-utils';
import type { PolicyCaller } from '../../common/auth/policies';
import { compareSizes, toCylinderSize } from '../pricing/size-label';
import { allowedActions } from './order-actions';
import { cancelTerms, loadOrdersForPolicy, type OrderForPolicy } from './orders-fee.policy';
import type { Db } from './support/tx';

/** What every OrderDto is built from. Driver data is limited to `{ id, name, phone }` (§7.6). */
export const ORDER_VIEW_INCLUDE = {
  lines: { include: { cylinderType: { select: { id: true, code: true, name: true, weightKg: true } } } },
  client: { select: { id: true, name: true, phone: true } },
  destZone: { select: { id: true, name: true } },
  originStore: { select: { id: true, name: true, address: true } },
  distributor: { select: { id: true, businessName: true, code: true } },
  trip: {
    select: {
      id: true,
      status: true,
      driverId: true,
      vehicle: { select: { plateNo: true } },
      driver: { select: { id: true, user: { select: { name: true, phone: true } } } },
    },
  },
} satisfies Prisma.OrderInclude;

export type OrderViewRow = Prisma.OrderGetPayload<{ include: typeof ORDER_VIEW_INCLUDE }>;

function iso(at: Date | null): string | null {
  return at ? at.toISOString() : null;
}

/** The order's human number: AG-0142. */
export function orderShortCode(code: string | null, orderNo: number | null): string {
  return formatNo(code, 'ORDER', orderNo ?? 0);
}

/**
 * Builds OrderDtos (API_CONTRACT §7) for one caller, in the order of `rows`: the stage, the order's
 * own copy of its cost, today's cancel terms and the caller's buttons under the current refund rule.
 * The office also gets `distributor`.
 */
export async function toOrderDtos(db: Db, rows: readonly OrderViewRow[], caller: PolicyCaller, rule: DeliveryStartedRule): Promise<OrderDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [pins, policy] = await Promise.all([
    db.$queryRaw<Array<{ id: string; lat: number; lng: number }>>`
      SELECT id, ST_Y(delivery_address) AS lat, ST_X(delivery_address) AS lng FROM orders WHERE id = ANY(${ids}::uuid[])`,
    loadOrdersForPolicy(db, ids),
  ]);
  const pinById = new Map(pins.map((pin) => [pin.id, { lat: pin.lat, lng: pin.lng }]));
  const office = caller.role === UserRole.SUPER_ADMIN;

  return rows.map((row) => {
    const view = policy.get(row.id) as OrderForPolicy;
    const terms = cancelTerms(view, rule);
    const lines = row.lines
      .map((line) => ({ line, size: toCylinderSize(line.cylinderType) }))
      .sort((a, b) => compareSizes(a.size, b.size) || a.line.id.localeCompare(b.line.id));
    const breakdownLines: OrderFeeLineDto[] = lines.map(({ line, size }) => ({
      cylinderTypeId: line.cylinderTypeId,
      sizeLabel: size.label,
      count: line.fullCount,
      perCylinderPaisa: (line.feePerCylinderPaisa ?? 0n).toString(),
      subtotalPaisa: (line.feePaisa ?? 0n).toString(),
    }));
    const dto: OrderDto = {
      id: row.id,
      orderNo: row.orderNo ?? 0,
      shortCode: orderShortCode(row.distributor.code, row.orderNo),
      status: row.status,
      stage: deriveOrderStage({ status: row.status, loadStartedAt: row.loadStartedAt, onTheWayAt: row.onTheWayAt }),
      client: { id: row.client.id, name: row.client.name, phone: row.client.phone },
      lines: lines.map(({ line, size }) => ({
        id: line.id,
        cylinderTypeId: line.cylinderTypeId,
        sizeLabel: size.label,
        fullCount: line.fullCount,
        expectedReturnCount: line.expectedReturnCount,
      })),
      deliveryAddressLabel: row.deliveryAddressLabel,
      destination: pinById.get(row.id) ?? { lat: 0, lng: 0 },
      destZone: { id: row.destZone.id, name: row.destZone.name },
      fee: {
        totalPaisa: row.deliveryFeePaisa.toString(),
        status: row.feeStatus,
        breakdown:
          row.feeStrategy === 'DISTRIBUTOR_ZONE' && row.feeBasePaisa !== null
            ? { basePaisa: row.feeBasePaisa.toString(), lines: breakdownLines }
            : null,
      },
      cancel: { allowed: terms.allowed, refundPaisa: terms.refundPaisa.toString(), noRefundReason: terms.noRefundReason },
      originStore: row.originStore ? { id: row.originStore.id, name: row.originStore.name, address: row.originStore.address } : null,
      trip: row.trip
        ? {
            id: row.trip.id,
            status: row.trip.status,
            driver: { id: row.trip.driver.id, name: row.trip.driver.user.name, phone: row.trip.driver.user.phone },
            vehicle: { plateNo: row.trip.vehicle.plateNo },
          }
        : null,
      createdAt: row.createdAt.toISOString(),
      assignedAt: iso(row.assignedAt),
      loadStartedAt: iso(row.loadStartedAt),
      onTheWayAt: iso(row.onTheWayAt),
      deliveredAt: iso(row.deliveredAt),
      deliveryMethod: row.deliveryMethod,
      cancelledAt: iso(row.cancelledAt),
      cancelReasonCode: (row.cancelReasonCode as OrderCancelReason | null) ?? null,
      failedAt: iso(row.failedAt),
      failureReasonCode: (row.failureReasonCode as DeliveryFailureReason | null) ?? null,
      failureNote: row.failureNote,
      deliveryFeePaisa: row.deliveryFeePaisa.toString(),
      paymentStatus: row.paymentStatus,
      allowedActions: allowedActions({ ...view, onTheWayAt: row.onTheWayAt, tripDriverId: row.trip?.driverId ?? null }, caller, rule),
    };
    if (office) dto.distributor = { id: row.distributor.id, businessName: row.distributor.businessName, code: row.distributor.code ?? '' };
    return dto;
  });
}
