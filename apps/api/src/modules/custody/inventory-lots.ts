import { CustodyType, CylinderState, type Prisma } from '@prisma/client';
import type { Tx } from '../orders/support/tx';

const UNCOUNTED: CylinderState[] = [CylinderState.FAULTY, CylinderState.LOST];

/** One side of a move, as the legacy inventory lots count it. */
export interface LotSide {
  holderType: CustodyType;
  holderId: string;
  state: CylinderState;
}

/**
 * Keeps the legacy inventory lots in step with each move (the Inc 1 inventory screens and
 * `GET /inventory/me` read them; Inc 2 screens count cylinders instead). Damaged and lost cylinders
 * aren't counted; an origin lot never goes below 0. Each count changes in one guarded statement,
 * never by read-modify-write: drivers loading at one store at the same moment lock only their own
 * trips and cylinders, so a read count could be stale by the time it is written (money-data-06).
 */
export async function adjustInventoryLots(
  tx: Tx,
  p: { distributorId: string; cylinderTypeId: string; from: LotSide | null; to: LotSide },
): Promise<void> {
  if (p.from && !UNCOUNTED.includes(p.from.state)) {
    const key = await ensureLot(tx, p.distributorId, p.cylinderTypeId, p.from);
    await tx.inventoryLot.updateMany({ where: { ...key, count: { gt: 0 } }, data: { count: { decrement: 1 } } });
  }
  if (!UNCOUNTED.includes(p.to.state)) {
    const key = await ensureLot(tx, p.distributorId, p.cylinderTypeId, p.to);
    await tx.inventoryLot.updateMany({ where: key, data: { count: { increment: 1 } } });
  }
}

/** Makes sure a lot row exists (at 0 when new; a racing insert of the same lot is skipped) and returns its key. */
async function ensureLot(
  tx: Tx,
  distributorId: string,
  cylinderTypeId: string,
  side: LotSide,
): Promise<Prisma.InventoryLotInventory_uniqueCompoundUniqueInput> {
  const key: Prisma.InventoryLotInventory_uniqueCompoundUniqueInput = {
    holderType: side.holderType,
    holderId: side.holderId,
    distributorId,
    cylinderTypeId,
    state: side.state,
  };
  await tx.inventoryLot.createMany({ data: [{ ...key, count: 0 }], skipDuplicates: true });
  return key;
}
