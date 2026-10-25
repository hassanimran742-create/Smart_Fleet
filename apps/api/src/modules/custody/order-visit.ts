import type { OrderVisitCylinder, OrderVisitDto, ReturnState } from '@smartfleet/shared-types';
import type { Db } from '../orders/support/tx';
import { cylinderShortCode } from './cylinder-codes';
import { sizeLabels } from './holders';

const RETURN_STATES: readonly string[] = ['EMPTY', 'PART_FILLED', 'FULL'];

function returnStateOf(value: string | null | undefined): ReturnState {
  return value && RETURN_STATES.includes(value) ? (value as ReturnState) : 'EMPTY';
}

/**
 * [Inc 2] An order's visit by cylinder number (`OrderVisitDto`, `GET /orders/:id` for the owning shop and
 * the office): the cylinders handed over and taken back on its visit (`stop_cylinders`, written by the
 * driver's scans and by the office's manual delivery), oldest first, and its unlabelled returns. Null
 * while nothing was given or taken back. Read only: it changes nothing and never touches money.
 */
export async function orderVisit(db: Db, orderId: string): Promise<OrderVisitDto | null> {
  const [rows, unlabelled] = await Promise.all([
    db.stopCylinder.findMany({
      where: { orderId },
      select: {
        cylinderTypeId: true,
        direction: true,
        returnState: true,
        cylinder: { select: { qrCode: true, shortNo: true, distributor: { select: { code: true } } } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    db.stopUnlabelledReturn.findMany({
      where: { orderId, count: { gt: 0 } },
      select: { cylinderTypeId: true, state: true, count: true },
      orderBy: [{ cylinderTypeId: 'asc' }, { state: 'asc' }],
    }),
  ]);
  if (rows.length === 0 && unlabelled.length === 0) return null;
  const sizes = await sizeLabels(db, [...rows.map((row) => row.cylinderTypeId), ...unlabelled.map((row) => row.cylinderTypeId)]);
  const label = (typeId: string) => sizes.get(typeId)?.label ?? '';
  const cylinderOf = (row: (typeof rows)[number]): OrderVisitCylinder => ({
    shortCode: cylinderShortCode(row.cylinder.distributor.code, row.cylinder.shortNo) ?? row.cylinder.qrCode,
    cylinderTypeId: row.cylinderTypeId,
    sizeLabel: label(row.cylinderTypeId),
  });
  return {
    given: rows.filter((row) => row.direction === 'GIVEN').map(cylinderOf),
    takenBack: rows.filter((row) => row.direction === 'TAKEN_BACK').map((row) => ({ ...cylinderOf(row), state: returnStateOf(row.returnState) })),
    unlabelled: unlabelled.map((row) => ({
      cylinderTypeId: row.cylinderTypeId,
      sizeLabel: label(row.cylinderTypeId),
      state: returnStateOf(row.state),
      count: row.count,
    })),
  };
}
