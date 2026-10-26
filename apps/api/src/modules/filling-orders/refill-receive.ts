/**
 * [Inc 3] The store's receive of a refill cylinder (API_CONTRACT §10.1 "The return is the store's receive
 * scan"; §9.2 STORE_RECEIVE: "a cylinder on an open refill line completes that line"). The refills module
 * owns the refill rows (§5.1: filling_orders, filling_order_cylinders), so the custody module's receive
 * calls these two steps around its own move write, in the receive's transaction:
 *
 *   const refill = await planRefillReceive(tx, cylinder);                  // after the cylinder lock
 *   const event = await this.writeMove(tx, { …, newState: refill?.toState ?? cylinder.state, fillingOrderId: refill?.fillingOrderId ?? null });
 *   if (refill) await finishRefillReceive(tx, this.audit, refill, { eventId: event.id, receivedByUserId: actor.userId, at: event.createdAt });
 *
 * - the SCAN_IN carries `filling_order_id`, and the cylinder comes back FULL when its line was filled
 *   (FAULTY and LOST stay as they are), else as it is;
 * - the line becomes RETURNED (`returned_at`; `filled_at` stays);
 * - when no picked line is left un-received the refill becomes COMPLETED in the same transaction, filled or
 *   not (G08-07), with the audit row `refill.complete` (actor SYSTEM). **No money**: a refill never writes
 *   to the wallet or its ledger.
 *
 * Locks: the receive has the cylinder locked; this takes the refill row next (cylinder first, then the
 * refill: the refill scans lock in the same order). The refill lock makes the "last cylinder back" check
 * safe when two phones scan a refill's last two cylinders at the same moment.
 *
 * The day-end approval uses the same two steps around a MOVE_TO_STORE fix of a cylinder still on an open
 * refill line (the shop counted it in the store, the receive scan was missed), so that line is RETURNED and
 * the refill can complete (actor SYSTEM `day-end:approve`). A SET_STATE or MARK_LOST fix keeps its holder,
 * so the line stays open until the store receives the cylinder.
 */
import { CylinderState, FillingOrderCylinderStatus, FillingOrderStatus } from '@prisma/client';
import { systemActor } from '../../common/auth/actor';
import type { AuditLogService } from '../audit-log/audit-log.service';
import { openRefillLineCylinderIds } from '../custody/custody-moves';
import type { Tx } from '../orders/support/tx';
import { sizeLabelOf } from '../pricing/size-label';
import { refillShortCode } from './refill.mapper';

/** The SYSTEM actor of a refill finished by the store's last receive scan (Appendix B `refill.complete`). */
export const REFILL_RECEIVE_ACTOR_LABEL = 'scan:store-receive';
/**
 * The SYSTEM actor of a refill finished by an approved day-end fix: a MOVE_TO_STORE of a cylinder still on
 * an open refill line brings it back into the store as the receive scan would (API_CONTRACT §10.2).
 */
export const REFILL_DAY_END_ACTOR_LABEL = 'day-end:approve';

/** What the store's receive of a cylinder on an open refill line must carry. */
export interface RefillReceivePlan {
  fillingOrderId: string;
  lineId: string;
  /** The line had a fill scan. */
  filled: boolean;
  /** The state the cylinder comes back in. */
  toState: CylinderState;
}

/** The refill statuses a receive can complete (§10.1 Refill v2). */
const COMPLETABLE: FillingOrderStatus[] = [
  FillingOrderStatus.ASSIGNED,
  FillingOrderStatus.EMPTIES_PICKED,
  FillingOrderStatus.AT_STATION,
  FillingOrderStatus.FILLED,
];
const KEEPS_STATE: CylinderState[] = [CylinderState.FAULTY, CylinderState.LOST];

/**
 * Before the receive's move, with the cylinder locked: its open refill line (PICKED_UP or FILLED, on a
 * refill that isn't COMPLETED or CANCELLED), or null for any other cylinder. Locks the refill row.
 */
export async function planRefillReceive(tx: Tx, cylinder: { id: string; state: CylinderState }): Promise<RefillReceivePlan | null> {
  const open = (await openRefillLineCylinderIds(tx, { cylinderIds: [cylinder.id] })).get(cylinder.id);
  if (!open) return null;
  await tx.$queryRaw`SELECT id FROM filling_orders WHERE id = ${open.fillingOrderId}::uuid FOR UPDATE`;
  const line = await tx.fillingOrderCylinder.findUnique({
    where: { fillingOrderId_cylinderId: { fillingOrderId: open.fillingOrderId, cylinderId: cylinder.id } },
    select: { id: true, status: true, filledAt: true, fillingOrder: { select: { status: true } } },
  });
  // Read again under the refill lock: a cancel or a completion may have closed it meanwhile.
  if (!line || line.status === FillingOrderCylinderStatus.RETURNED || !COMPLETABLE.includes(line.fillingOrder.status)) return null;
  const filled = line.filledAt !== null;
  return {
    fillingOrderId: open.fillingOrderId,
    lineId: line.id,
    filled,
    toState: filled && !KEEPS_STATE.includes(cylinder.state) ? CylinderState.FULL : cylinder.state,
  };
}

/**
 * After the receive's move: the line RETURNED and, when it was the last picked line still out, the refill
 * COMPLETED with `refill.complete` (actor SYSTEM). Returns whether this receive completed the refill.
 */
export async function finishRefillReceive(
  tx: Tx,
  audit: Pick<AuditLogService, 'record'>,
  plan: RefillReceivePlan,
  receive: { eventId: string; receivedByUserId: string; at?: Date; actorLabel?: string },
): Promise<{ completed: boolean }> {
  const at = receive.at ?? new Date();
  await tx.fillingOrderCylinder.update({
    where: { id: plan.lineId },
    data: { status: FillingOrderCylinderStatus.RETURNED, returnedAt: at },
  });
  const out = await tx.fillingOrderCylinder.count({
    where: { fillingOrderId: plan.fillingOrderId, status: { not: FillingOrderCylinderStatus.RETURNED } },
  });
  if (out > 0) return { completed: false };
  const done = await tx.fillingOrder.updateMany({
    where: { id: plan.fillingOrderId, status: { in: COMPLETABLE } },
    data: { status: FillingOrderStatus.COMPLETED, completedAt: at },
  });
  if (done.count !== 1) return { completed: false };
  const refill = await tx.fillingOrder.findUniqueOrThrow({
    where: { id: plan.fillingOrderId },
    select: {
      id: true,
      distributorId: true,
      refillNo: true,
      requestedCount: true,
      distributor: { select: { businessName: true, code: true } },
      cylinderType: { select: { name: true, weightKg: true } },
      cylinders: { select: { filledAt: true } },
    },
  });
  await audit.record(
    {
      action: 'refill.complete',
      actor: systemActor(receive.actorLabel ?? REFILL_RECEIVE_ACTOR_LABEL),
      resourceType: 'refill',
      resourceId: refill.id,
      distributorId: refill.distributorId,
      diff: {
        distributor: refill.distributor.businessName,
        refill: refillShortCode(refill.distributor.code, refill.refillNo),
        count: refill.requestedCount,
        size: sizeLabelOf(refill.cylinderType),
        picked: refill.cylinders.length,
        filled: refill.cylinders.filter((line) => line.filledAt !== null).length,
        receivedBy: receive.receivedByUserId,
        eventId: receive.eventId,
      },
    },
    tx,
  );
  return { completed: true };
}
