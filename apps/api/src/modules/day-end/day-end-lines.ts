import type { Prisma } from '@prisma/client';
import type { Tx } from '../orders/support/tx';

/**
 * [Inc 3] Replaces a day's lines with a new upload's (API_CONTRACT §10.2: one per cylinder of the
 * distributor, plus one per extra row), keeping the link of every fix an earlier approval of this day
 * applied (the day was reopened, "applied fixes stay"; review23 holder-scans-07). The new line of the same
 * cylinder (a fix), or of the same extra number (a REGISTER), takes over the old line's `applied_event_id`;
 * a registered number left off the new sheet passes it to the new cylinder's own line. So:
 * - the cylinder history keeps naming the day on that event ("Fixed at day-end …", "… from the day-end
 *   sheet");
 * - an extra number this day already registered isn't registered again: the approval counts it unchanged
 *   (DayEndOfficeService), and it isn't one of the office's `fixesToApply`.
 * Runs inside the upload's transaction, after its checks; nothing here reads the file.
 */
export async function replaceDayLines(tx: Tx, dayCloseId: string, lines: Prisma.DayCloseLineCreateManyInput[]): Promise<void> {
  const applied = await tx.dayCloseLine.findMany({
    where: { dayCloseId, appliedEventId: { not: null } },
    select: { sheetKey: true, cylinderId: true, appliedEventId: true, appliedEvent: { select: { cylinderId: true } } },
  });
  if (applied.length > 0) {
    const byCylinder = new Map(lines.filter((line) => line.cylinderId).map((line) => [line.cylinderId as string, line]));
    const extraByKey = new Map(lines.filter((line) => !line.cylinderId).map((line) => [line.sheetKey, line]));
    for (const old of applied) {
      const target = old.cylinderId
        ? byCylinder.get(old.cylinderId)
        : extraByKey.get(old.sheetKey) ?? (old.appliedEvent ? byCylinder.get(old.appliedEvent.cylinderId) : undefined);
      if (target && !target.appliedEventId) target.appliedEventId = old.appliedEventId;
    }
  }
  // The old lines go first: `applied_event_id` is unique, and the new lines carry the links over.
  await tx.dayCloseLine.deleteMany({ where: { dayCloseId } });
  if (lines.length > 0) await tx.dayCloseLine.createMany({ data: lines });
}
