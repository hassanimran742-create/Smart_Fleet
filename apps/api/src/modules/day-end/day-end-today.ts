import { DayCloseStatus } from '@prisma/client';
import type { AdminSummaryDto } from '@smartfleet/shared-types';
import type { Db } from '../orders/support/tx';
import type { SettingsService } from '../settings/settings.service';
import { isoDateOf } from './day-end-core';

/**
 * [Inc 3] The office Today card "Day-end ready to approve" (`AdminSummaryDto.dayEnd`, UX spec §3.4,
 * UX_ADMIN §4.4): the days waiting for approval (SUBMITTED) and the oldest of them by business date.
 * Undefined while `dayEnd.enabled` is off (the card then doesn't show). Read-only, so the admin summary
 * can call it without depending on the day-end services.
 */
export async function dayEndTodayCard(db: Db, settings: Pick<SettingsService, 'get'>): Promise<AdminSummaryDto['dayEnd']> {
  if (!(await settings.get('dayEnd.enabled'))) return undefined;
  const [toApprove, oldest] = await Promise.all([
    db.dayClose.count({ where: { status: DayCloseStatus.SUBMITTED } }),
    db.dayClose.findFirst({
      where: { status: DayCloseStatus.SUBMITTED },
      orderBy: [{ businessDate: 'asc' }, { submittedAt: 'asc' }, { id: 'asc' }],
      include: { distributor: { select: { id: true, businessName: true } } },
    }),
  ]);
  return {
    toApprove,
    oldest: oldest
      ? { id: oldest.id, businessDate: isoDateOf(oldest.businessDate), distributor: { id: oldest.distributor.id, name: oldest.distributor.businessName } }
      : null,
  };
}
